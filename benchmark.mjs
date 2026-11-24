import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createAuditCore } from './core.mjs';
import { createEngine } from './engine.mjs';
import { createSemanticRanker } from './semantic.mjs';
import { cityCorpusHash } from './corpus-identity.mjs';

const project = path.dirname(fileURLToPath(import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');
const ratio = (n, d) => d ? n / d : null;
const clean = s => s.normalize('NFC').replace(/\s+/gu, ' ').trim();
const fixedOrigin = 'https://seongnam-audit.gnudas0923.chatgpt.site/public-mcp';

export async function loadSuite(suiteName='v1') {
  assert.ok(['v1','reserve-v1','final-v1'].includes(suiteName),'unknown suite');
  const directory = path.join(project, 'benchmarks',suiteName==='v1'?'':suiteName);
  const config = JSON.parse(await readFile(path.join(directory, 'config.json'), 'utf8'));
  const [questions, judgments] = await Promise.all(['questions.json','judgments.json'].map(async name => {
    const text = (await readFile(path.join(directory,name),'utf8')).replace(/\r\n/g,'\n');
    assert.equal(digest(text),config.hashes[name],name + ' differs from the published benchmark version');
    return JSON.parse(text);
  }));
  assert.deepEqual(questions.map(q=>q.id),judgments.map(j=>j.id));
  assert.equal(new Set(questions.map(q=>q.id)).size, questions.length);
  const sourceIds = new Set();
  for (const split of Object.keys(config.split_size)) {
    const positives = questions.filter((q,i)=>q.split === split && judgments[i].expected.length);
    const total = questions.filter(q=>q.split === split).length;
    assert.deepEqual({positive:positives.length,negative:total-positives.length},config.split_size[split]);
  }
  for (let i=0; i<questions.length; i++) {
    const q=questions[i],j=judgments[i];
    assert.ok(Object.hasOwn(config.split_size,q.split) && typeof q.query === 'string' && q.query.trim().length >= 2);
    assert.ok(Object.keys(q.filters).every(k=>['year','agency','category'].includes(k)));
    assert.equal(j.kind === 'positive',j.expected.length > 0);
    for (const e of j.expected) {
      assert.match(e.case_id,/^city-\d+$/);
      assert.equal(e.source_url,'https://www.seongnam.go.kr/pm030305/'+e.case_id.slice(5));
      assert.ok(!sourceIds.has(e.case_id),'gold source reused across queries: '+e.case_id);
      sourceIds.add(e.case_id);
      assert.ok(e.quote.length>=12 && e.quote.length<=150 && e.location==='html:body');
      for (const [field,value] of Object.entries(q.filters)) assert.equal(e[field],value);
    }
  }
  return {config,questions,judgments};
}

function quantile(values,p) {
  if (!values.length) return null;
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted[Math.ceil(sorted.length*p)-1];
}

export function summarize(rows, k=5, at=3) {
  const positives=rows.filter(r=>r.kind==='positive');
  const negative=rows.filter(r=>r.kind!=='positive');
  const times=rows.slice(1).map(r=>r.researchMs);
  const hit=n=>positives.filter(r=>r.rank!==null && r.rank<=n).length;
  const checked=positives.filter(r=>r.sourceVerified===true).length;
  const abstained=negative.filter(r=>r.abstained).length;
  return {
    count:rows.length,positive:positives.length,negative:negative.length,
    correctTop1:hit(1),correctTop3:hit(at),correctTop5:hit(k),correctAbstentions:abstained,verifiedSources:checked,
    hitAt1:ratio(hit(1),positives.length),hitAt3:ratio(hit(at),positives.length),hitAt5:ratio(hit(k),positives.length),
    mrrAt5:ratio(positives.reduce((s,r)=>s+(r.rank!==null && r.rank<=k?1/r.rank:0),0),positives.length),
    abstention:ratio(abstained,negative.length),sourceVerification:ratio(checked,positives.length),
    researchLatencyMs:{first:rows[0]?.researchMs??null,remaining:times.length,p50:quantile(times,.5),p95:quantile(times,.95)},
  };
}

async function loadLocal() {
  const [city,pages]=await Promise.all(['city.json','city-pages.json'].map(async name=>JSON.parse(await readFile(path.join(project,'snapshot',name),'utf8'))));
  const loadSet=async name=>name==='city'?{...city,pages}:null;
  const [lexical, hybrid, original]=await Promise.all([
    createAuditCore({loadSet,ranker:null}),
    createSemanticRanker(project).then(ranker=>createAuditCore({loadSet,ranker})),
    createEngine(project),
  ]);
  return {services:{lexical,hybrid},original,sourceFingerprint:cityCorpusHash(city,pages),status:hybrid.status()};
}

async function codeFingerprint(filenames) {
  const inputs=await Promise.all(filenames.map(async name=>[name,digest((await readFile(path.join(project,name),'utf8')).replace(/\r\n/g,'\n'))]));
  return digest(JSON.stringify(inputs));
}

function openRemote(endpoint) {
  let id=0;
  async function tool(name,args={}) {
    const requestId=++id;
    const response=await fetch(endpoint,{
      method:'POST',headers:{'content-type':'application/json','accept':'application/json, text/event-stream'},
      body:JSON.stringify({jsonrpc:'2.0',id:requestId,method:'tools/call',params:{name,arguments:args}}),signal:AbortSignal.timeout(30000),
    });
    if (!response.ok) throw Error('MCP HTTP '+response.status+' for '+name);
    const message=await response.json();
    assert.equal(message.id,requestId,'MCP response id');
    assert.ok(!message.error && !message.result?.isError && message.result?.structuredContent,'MCP tool failed: '+name);
    return message.result.structuredContent;
  }
  return {research:a=>tool('audit_research',a),original:a=>tool('get_audit_original',a),verify:a=>tool('verify_audit_evidence',a),status:()=>tool('get_audit_status')};
}

export function gradeFirstResponse(response, judgment, input, k) {
  assert.ok(Array.isArray(response.matches) && response.matches.length<=k && response.requires_verification === true);
  const ids=response.matches.map(r=>r.case_id);
  assert.equal(new Set(ids).size,ids.length);
  assert.equal(response.match_status,ids.length?'matched':'no_match');
  for (const r of response.matches) {
    if(input.filters.year!==undefined) assert.equal(r.year,input.filters.year,'year filter ignored');
    for (const key of ['agency','category']) if(input.filters[key]) assert.ok(r[key]?.replace(/\s/g,'').includes(input.filters[key].replace(/\s/g,'')),key+' filter ignored');
  }
  const rank=response.matches.findIndex(r=>judgment.expected.some(e=>e.case_id===r.case_id && e.source_url===r.source_url &&
    e.year===r.year && e.agency===r.agency && e.category===r.category && r.evidence?.some(x=>x.location===e.location && x.case_id===r.case_id)));
  return {rank:rank<0?null:rank+1,returned:ids,abstained:response.match_status==='no_match',semanticUsed:response.semantic_used===true};
}

async function verifyGold(service, judgments) {
  const checked=new Map();
  const positives=judgments.filter(j=>j.expected.length);
  for (let i=0;i<positives.length;i+=4) {
    await Promise.all(positives.slice(i,i+4).map(async j=>{
      const citations=[];
      const hashes=[];
      for (const gold of j.expected) {
        const {case_id,location,quote}=gold;
        const original=await service.original({case_id,location,focus:quote});
        if (!original.verified || original.source_url!==gold.source_url || !/^[0-9a-f]{64}$/.test(original.sha256) ||
          !original.locations.some(row=>row.location===location && clean(row.text).includes(clean(quote)))) {
          checked.set(j.id,{verified:false});return;
        }
        citations.push({case_id,location,quote});hashes.push(original.sha256);
      }
      const final=await service.verify({evidence:citations});
      const verified=final.verified===true && final.evidence?.length===citations.length && final.evidence.every((ev,index)=>
        ev.verified===true && ev.sha256===hashes[index] && ev.source_url===j.expected[index].source_url &&
        ev.case_id===citations[index].case_id && ev.location===citations[index].location && clean(ev.quote)===clean(citations[index].quote));
      checked.set(j.id,{verified,hashes});
    }));
  }
  return checked;
}

async function evaluate(services,sourceVerifier,suite,which,identity) {
  const {config,questions,judgments}=suite;
  const splits=which==='all'?Object.keys(config.split_size):[which];
  const inputs=questions.map((q,i)=>({q,j:judgments[i]})).filter(({q})=>splits.includes(q.split));
  const modes={};
  for (const [name,service] of Object.entries(services)) {
    const rows=[];
    for (const {q,j} of inputs) {
      const start=performance.now();
      const result=await service.research({query:q.query,...q.filters,limit:config.k});
      const researchMs=Math.round((performance.now()-start)*10)/10;
      const grade=gradeFirstResponse(result,j,q,config.k);
      if (j.kind==='positive' && grade.returned.length) assert.equal(grade.semanticUsed,name!=='lexical','unexpected retrieval mode');
      rows.push({id:q.id,split:q.split,kind:j.kind,category:j.expected[0]?.category,researchMs,...grade});
    }
    modes[name]={rows};
  }
  // No gold IDs or quotes enter first retrieval. Reopen and verify the pre-labelled official sources after all rankings have been recorded.
  const checked=await verifyGold(sourceVerifier,inputs.map(x=>x.j));
  const gates=[];
  for (const [name,mode] of Object.entries(modes)) {
    for(const row of mode.rows) {
      const source=checked.get(row.id);
      if(source) {row.sourceVerified=source.verified;row.sourceHashes=source.hashes??[];}
    }
    mode.bySplit={};
    for(const split of splits) {
      const rows=mode.rows.filter(r=>r.split===split);
      const summary=summarize(rows,config.k,config.report_at);
      mode.bySplit[split]=summary;
      if(name!=='lexical') for(const [metric,minimum] of Object.entries(config.thresholds)) {
        const actual=summary[metric];
        gates.push({mode:name,split,metric,minimum,actual,passed:actual!==null && actual>=minimum});
      }
    }
    mode.byCategory={};
    for(const [category,rows] of Object.entries(Object.groupBy(mode.rows.filter(r=>r.kind==='positive'),r=>r.category))) {
      mode.byCategory[category]={count:rows.length,hitAt3:summarize(rows).hitAt3};
    }
    mode.overall=summarize(mode.rows);
  }
  return {benchmark:config.version,recordedAt:new Date().toISOString(),...identity,fixtureSha256:config.hashes,modes,gates,passed:gates.every(g=>g.passed)};
}

async function main() {
  const {values}=parseArgs({options:{mode:{type:'string',default:'compare'},split:{type:'string',default:'all'},suite:{type:'string',default:'v1'},url:{type:'string'},output:{type:'string'}}});
  assert.ok(['compare','live'].includes(values.mode),'expected --mode compare|live');
  const suite=await loadSuite(values.suite);
  assert.ok(values.split==='all' || Object.hasOwn(suite.config.split_size,values.split),'unknown split for active suite');
  let report;
  if(values.mode==='compare') {
    assert.equal(values.url,undefined,'--url is for --mode live');
    const local=await loadLocal();
    report=await evaluate(local.services,local.original,suite,values.split,{target:'local-city',searchableCases:local.status.searchable_cases,corpusSha256:local.sourceFingerprint});
  } else {
    const endpoint=new URL(values.url??fixedOrigin);
    assert.ok(!endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash && (endpoint.protocol==='https:' || endpoint.protocol==='http:' && ['127.0.0.1','localhost'].includes(endpoint.hostname)),'expected HTTPS MCP endpoint or localhost');
    const service=openRemote(endpoint);
    const status=await service.status();
    assert.ok(status.coverage?.city?.cases>0 && status.searchable_cases===status.coverage.city.cases,'expected a city-only public corpus');
    assert.match(status.corpus_sha256,/^[a-f0-9]{64}$/,'public corpus fingerprint missing');
    report=await evaluate({live:service},service,suite,values.split,{target:endpoint.href,searchableCases:status.searchable_cases,corpusSha256:status.corpus_sha256,collectionDate:status.coverage.city.retrieved_at});
  }
  report.evaluatorSha256=await codeFingerprint(['benchmark.mjs','benchmarks/config.json']);
  report.localRetrievalCodeSha256=values.mode==='compare'?await codeFingerprint(['core.mjs','semantic-core.mjs','semantic.mjs']):null;
  if(values.output) await writeFile(values.output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({benchmark:report.benchmark,passed:report.passed,searchableCases:report.searchableCases,bySplit:Object.fromEntries(Object.entries(report.modes).map(([name,mode])=>[name,mode.bySplit])),failedGates:report.gates.filter(g=>!g.passed)},null,2));
  if(!report.passed) process.exitCode=1;
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error=>{console.error(error.message);process.exitCode=1;});
