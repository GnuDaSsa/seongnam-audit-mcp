import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateAnswers, replayTurn } from '../answer-benchmark.mjs';

const quote='같은 유형의 구매를 여러 건으로 처리하였습니다.';
const evidence={case_id:'city-11',location:'html:body',quote};
const turn={disposition:'case',searches:[{query:'구매 사례'}],text:quote+' https://www.seongnam.go.kr/pm030305/11',evidence:[evidence]};
const sourceHash='c'.repeat(64);
async function call(name) {
  if (name==='audit_research') return {matches:[{case_id:evidence.case_id}],match_status:'matched'};
  if (name==='get_audit_original') return {verified:true,sha256:sourceHash,locations:[{location:evidence.location,text:quote}]};
  return {verified:true,evidence:[{...evidence,verified:true,sha256:sourceHash}]};
}
test('answer verifier checks cited cases from final text, source hash and last tool call',async()=>{
  const calls=await replayTurn(turn,call);
  assert.equal(calls.at(-1).tool,'verify_audit_evidence');
  await assert.rejects(replayTurn({...turn,text:turn.text+' https://www.seongnam.go.kr/pm030305/12'},call));
  await assert.rejects(replayTurn({...turn,text:'https://www.seongnam.go.kr/pm030305/11'},call));
  await assert.rejects(replayTurn(turn,async(name,args)=> {
    const data=await call(name,args);
    if (name==='verify_audit_evidence') data.evidence[0].sha256='changed';
    return data;
  }));
});
test('missing turns and inaccurate answers stay in the full scenario denominator',async()=>{
  const suite={questions:[{id:'one',turns:['첫 질문','후속 질문']},{id:'two',turns:['다른 질문']}],
    answers:[{id:'one',turns:[turn]}],ratings:{results:[{id:'one',turns:[{accurate:false,useful:true,reason:'적용 기준이 다름'}]}]}};
  const out=await evaluateAnswers(suite,call);
  assert.deepEqual(out.conversations,{total:2,accurate:0,useful:0});
  assert.deepEqual(out.turns,{total:3,accurate:0,useful:0});
  assert.equal(out.evidence_replayed,1);
});
