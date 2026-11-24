import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { production } from './live-check.mjs';

const answerDirectories = new Map([
  ['first-v1', new URL('./benchmarks/answer/', import.meta.url)],
  ['final-v1', new URL('./benchmarks/answer-final/', import.meta.url)],
]);
const clean = text => text.normalize('NFC').replace(/\s+/gu, ' ').trim();
const digest = text => createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');

// The grader sees the frozen key after the answers have been written. A different
// answer artifact or key invalidates the review, even when all case IDs still match.
export async function loadAnswerSuite(name = 'first-v1') {
  const dir = answerDirectories.get(name);
  if (!dir) throw Error('알 수 없는 답변 평가군: ' + name);
  const [sealed, questions, key, answers, review] = await Promise.all(
    ['frozen.json','questions.json','key.json','first-answers.json','review.json'].map(file => readFile(new URL(file, dir), 'utf8')));
  const hashes = JSON.parse(sealed).files;
  const ratings = JSON.parse(review);
  if (hashes['questions.json'] !== digest(questions) || hashes['key.json'] !== digest(key) ||
      ratings.answers_sha256 !== digest(answers) || ratings.key_sha256 !== digest(key)) {
    throw Error('질문·정답표·채점 당시 답변의 지문을 확인하세요.');
  }
  return {questions:JSON.parse(questions), answers:JSON.parse(answers), ratings,
    hashes:{...hashes, 'first-answers.json':digest(answers), 'review.json':digest(review)}};
}

function toolClient(endpoint) {
  let id = 0;
  return async (name,args) => {
    const requestId = ++id;
    const res = await fetch(endpoint,{method:'POST',signal:AbortSignal.timeout(30_000),
      headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},
      body:JSON.stringify({jsonrpc:'2.0',id:requestId,method:'tools/call',params:{name,arguments:args}})});
    if (!res.ok) throw Error('HTTP ' + res.status);
    const rpc = await res.json();
    if (rpc.id !== requestId || rpc.error || rpc.result?.isError || !rpc.result?.structuredContent) throw Error('MCP 도구 응답 오류: ' + name);
    return rpc.result.structuredContent;
  };
}

export async function replayTurn(turn, call, previousCases = new Set()) {
  if (!turn?.text || !Array.isArray(turn.evidence) || !turn.searches?.length) throw Error('답변·검색 기록 누락');
  const calls = [];
  for (const query of turn.searches) {
    const result = await call('audit_research',query);
    const ids = result.matches.map(row=>row.case_id);
    calls.push({tool:'audit_research', match_status:result.match_status, ids});
    for (const id of ids) previousCases.add(id);
  }
  const idsInAnswer = [...turn.text.matchAll(/https:\/\/www\.seongnam\.go\.kr\/pm030305\/(\d+)/g)].map(m=>'city-' + m[1]);
  const cited = new Set(turn.evidence.map(row=>row.case_id));
  if (idsInAnswer.some(id=>!cited.has(id))) throw Error('최종 검증에서 빠진 본문 출처');
  if (turn.disposition === 'case' && !cited.size) throw Error('사례를 든 답변의 근거 누락');
  if (!['case','abstain','clarify'].includes(turn.disposition)) throw Error('응답 상태 누락');
  for (const e of turn.evidence) {
    if (!previousCases.has(e.case_id) || !idsInAnswer.includes(e.case_id) || !clean(turn.text).includes(clean(e.quote))) {
      throw Error('검색 이력·완성된 답변·인용 목록 불일치: ' + e.case_id);
    }
    const src = await call('get_audit_original',{case_id:e.case_id,location:e.location,focus:e.quote});
    if (!src.verified || !src.locations.some(v=>v.location===e.location && clean(v.text).includes(clean(e.quote)))) throw Error('원문 재조회 실패: ' + e.case_id);
    calls.push({tool:'get_audit_original',case_id:e.case_id,location:e.location,sha256:src.sha256});
  }
  if (cited.size) {
    const v = await call('verify_audit_evidence',{evidence:turn.evidence});
    if (!v.verified || v.evidence.length !== turn.evidence.length || v.evidence.some((r,i)=>
      !r.verified || r.case_id !== turn.evidence[i].case_id || r.location !== turn.evidence[i].location ||
      clean(r.quote) !== clean(turn.evidence[i].quote) || !calls.some(c=>c.case_id === r.case_id && c.sha256 === r.sha256))) throw Error('최종 일괄 대조 실패');
    calls.push({tool:'verify_audit_evidence',verified:true,count:v.evidence.length});
  }
  return calls;
}

export async function evaluateAnswers(suite,call) {
  const results = [];
  for (const q of suite.questions) {
    const answer = suite.answers.find(row=>row.id===q.id), review = suite.ratings.results.find(row=>row.id===q.id);
    const previousCases = new Set();
    const turns = [];
    for (let i=0; i<q.turns.length; i++) {
      try {
        const calls = await replayTurn(answer?.turns?.[i],call,previousCases);
        const rating = review?.turns?.[i];
        if (typeof rating?.accurate !== 'boolean' || typeof rating?.useful !== 'boolean' || !rating.reason) throw Error('독립 채점 누락');
        turns.push({calls,evidence_replayed:true,accurate:rating.accurate,useful:rating.accurate && rating.useful,reason:rating.reason});
      } catch (error) { turns.push({evidence_replayed:false,accurate:false,useful:false,reason:error.message}); }
    }
    results.push({id:q.id,turns,accurate:turns.every(t=>t.accurate),useful:turns.every(t=>t.useful)});
  }
  const all = results.flatMap(r=>r.turns);
  const counts = rows=>({total:rows.length,accurate:rows.filter(r=>r.accurate).length,useful:rows.filter(r=>r.useful).length});
  return {conversations:counts(results),turns:counts(all),evidence_replayed:all.filter(t=>t.evidence_replayed).length,results};
}

async function main() {
  const {values} = parseArgs({options:{endpoint:{type:'string',default:production},suite:{type:'string',default:'first-v1'},output:{type:'string'},'check-freeze':{type:'boolean'},'replay-only':{type:'boolean'}}});
  const suite = await loadAnswerSuite(values.suite);
  if (values['check-freeze']) { console.log(JSON.stringify(suite.hashes,null,2));return; }
  const report = {suite:values.suite,endpoint:values.endpoint,checked_at:new Date().toISOString(),hashes:suite.hashes,
    ...await evaluateAnswers(suite,toolClient(values.endpoint))};
  if (values.output) await writeFile(values.output,JSON.stringify(report,null,2)+'\n','utf8');
  console.log(JSON.stringify({conversations:report.conversations,turns:report.turns,evidence_replayed:report.evidence_replayed},null,2));
  if (!report.conversations.total || report.evidence_replayed !== report.turns.total ||
      (!values['replay-only'] && (report.conversations.accurate/report.conversations.total < .95 ||
        report.conversations.useful/report.conversations.total < .95))) process.exitCode=1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
