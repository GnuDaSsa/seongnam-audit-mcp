import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import worker, {hostedEngine} from '../dist/server/index.js';

const assets = new URL('../dist/client/', import.meta.url);
const env = {ASSETS:{async fetch(request) {
  try { return new Response(await readFile(new URL(new URL(request.url).pathname.slice(1), assets))); }
  catch { return new Response(null, {status:404}); }
}}};
const request = (path, method='GET', body=null) => new Request('https://audit.example'+path,{method, body});
async function call(name,args,path='/public-mcp') {
  const r = await worker.fetch(request(path,'POST',JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})),env);
  assert.equal(r.status,200);
  return (await r.json()).result;
}

test('공개 MCP 검색, 원문 재조회, 최종 일치와 불일치, 짧은 인용 및 자료 범위', async () => {
  const status = (await call('get_audit_status',{})).structuredContent;
  assert.ok(status.case_count > 0);
  assert.equal(status.coverage.city.cases,status.case_count);
  assert.equal(status.coverage.foundation.cases,0);
  const result = (await call('audit_research',{query:'지연배상금 부과',limit:4})).structuredContent;
  const hit = result.matches.find(r=>r.title.includes('지연배상금'));
  assert.ok(hit);
  assert.equal(result.semantic_used,true);
  assert.equal(result.requires_verification,true);
  assert.match(hit.source_url,/^https:\/\/www\.seongnam\.go\.kr\/pm030305\/\d+$/);
  const evidence = hit.evidence[0];
  assert.ok(evidence.quote.length <= 150);
  const original = (await call('get_audit_original',{case_id:hit.case_id,focus:evidence.quote},'/mcp')).structuredContent;
  assert.equal(original.verified,true);
  assert.ok(original.locations.some(loc=>loc.text.includes(evidence.quote)));
  assert.ok(original.locations.every(loc=>loc.excerpt_only && loc.text.length <= 190));
  assert.equal((await call('get_audit_original',{case_id:hit.case_id,focus:'원문에 없는 시험용 문구'})).structuredContent.verified,false);
  const verified = (await call('verify_audit_evidence',{evidence:[evidence]})).structuredContent;
  assert.ok(verified.verified);
  assert.equal(verified.evidence[0].sha256,original.sha256);
  assert.ok(verified.evidence[0].context.length <= 190);
  assert.ok(!('case_contexts' in verified));
  const failed = (await call('verify_audit_evidence',{evidence:[{...evidence,quote:'이것은 원문에서 확인할 수 없는 가상의 인용문입니다.'}]})).structuredContent;
  assert.equal(failed.verified,false);
  assert.equal((await call('audit_research',{query:'문의 주소 user@example.com'})).isError,true);
});

test('직접 경로로 내부 색인, 양식, 원본 HTML을 받을 수 없음', async () => {
  for (const path of ['/snapshot/city-pages.json','/originals/city/4854.html.gz','/server/index.js','/dist/client/','/admin']) {
    assert.equal((await worker.fetch(request(path),env)).status,404);
    assert.equal((await env.ASSETS.fetch(request(path))).status,404);
  }
  assert.equal((await worker.fetch(request('/public-mcp'),env)).status,405);
  assert.equal((await worker.fetch(request('/mcp','POST','{INVALID'),env)).status,400);
  assert.equal((await worker.fetch(request('/mcp','POST',' '.repeat(100000)),env)).status,400);
});

test('검색용 글은 같아도 독립 HTML 원본이 바뀌면 최종 대조가 실패', async () => {
  const first = '지방계약 절차에 관련된 기관의 원문 인용과 자료입니다.';
  const sha256 = createHash('sha256').update(first).digest('hex');
  const pack = x=>gzipSync(Buffer.from(JSON.stringify(x))).toString('base64');
  const source = {id:'city-1',title:'계약',url:'https://www.seongnam.go.kr/pm030305/1',year:2024,authority:'성남시',format:'html',shard:0,sha256};
  const entry = {id:source.id,source_id:source.id,title:'계약',year:2024,agency:'시청',category:'계약',locations:['html:body']};
  const sets = {city:{sources:[source],cases:[entry],coverage:{},pages:{'city-1':{'html:body':first}}}};
  const bundle = {catalog:pack(sets),entities:{},originals:[pack({'city-1':{id:'city-1',markup:first+'변경'}})]};
  const engine = await hostedEngine(env,bundle);
  const result = await engine.verify({evidence:[{case_id:'city-1',location:'html:body',quote:first.slice(0,20)}]});
  assert.equal(result.verified,false);
  assert.equal(result.evidence[0].error,'original_hash_mismatch');
});
