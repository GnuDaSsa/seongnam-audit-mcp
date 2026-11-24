import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { gradeFirstResponse,loadSuite,summarize } from '../benchmark.mjs';

test('frozen questions and answers have disjoint case IDs and the declared split sizes',async()=>{
  const {questions,judgments}=await loadSuite();
  const developerRegression=JSON.parse(await readFile(new URL('../test-cases.json',import.meta.url),'utf8'));
  const used=new Set(developerRegression.cases.map(r=>r.case_id));
  for(const j of judgments) for(const key of j.expected) assert.ok(!used.has(key.case_id));
  assert.ok(questions.every(q=>!('expected' in q) && !('case_id' in q) && !('quote' in q)));
});

test('reserve and final suites have fresh questions and gold sources across published fixtures', async () => {
  const [first, reserve, final, developer, answers, answerQuestions, history, liveChecks] = await Promise.all([
    loadSuite(), loadSuite('reserve-v1'), loadSuite('final-v1'), ...['test-cases.json','benchmarks/answer/key.json','benchmarks/answer/questions.json','benchmarks/run-history.json']
      .map(async file => JSON.parse(await readFile(new URL('../' + file, import.meta.url),'utf8'))),
    readFile(new URL('../live-check.mjs', import.meta.url),'utf8'),
  ]);
  const priorSources = new Set([
    ...first.judgments.flatMap(row => row.expected.map(source => source.case_id)),
    ...developer.cases.map(row => row.case_id),
    ...answers.cases.flatMap(row => row.acceptable_case_ids ?? []),
    ...(liveChecks.match(/city-\d+/g) ?? []),
  ]);
  const oldQuestions = new Set([
    ...first.questions.map(row => row.query),
    ...[...developer.cases, ...developer.no_match].map(row => row.query),
    ...answerQuestions.flatMap(row => row.turns),
  ]);
  for (const [split, suite] of [['reserve', reserve], ['final', final]]) {
    for (const row of suite.questions) {
      assert.equal(row.split, split);
      assert.ok(!oldQuestions.has(row.query), 'reused question ' + row.id);
      oldQuestions.add(row.query);
      assert.deepEqual(Object.keys(row).sort(), ['filters','id','query','split']);
    }
    for (const row of suite.judgments) {
      for (const source of row.expected) {
        assert.ok(!priorSources.has(source.case_id), 'reused source ' + source.case_id);
        priorSources.add(source.case_id);
      }
    }
    assert.deepEqual(suite.config.thresholds, first.config.thresholds, split + ' uses the preregistered minimums');
  }
  assert.deepEqual(history.reserveFirstRun.fixtureSha256, reserve.config.hashes);
});

test('top-k hit, reciprocal rank and abstention use separate denominators; misses count as zero',()=>{
  const rows=[
    {kind:'positive',rank:1,sourceVerified:true,researchMs:900},
    {kind:'positive',rank:3,sourceVerified:true,researchMs:10},
    {kind:'positive',rank:null,sourceVerified:false,researchMs:20},
    {kind:'positive',rank:5,sourceVerified:true,researchMs:15},
    {kind:'underspecified',rank:null,abstained:true,researchMs:5},
    {kind:'out_of_scope',rank:null,abstained:false,researchMs:30},
  ];
  const s=summarize(rows);
  assert.deepEqual([s.hitAt1,s.hitAt3,s.hitAt5,s.abstention,s.sourceVerification],[.25,.5,.75,.5,.75]);
  assert.equal(s.mrrAt5,(1+1/3+1/5)/4);
  assert.deepEqual(s.researchLatencyMs,{first:900,remaining:5,p50:15,p95:30});
  assert.equal(summarize([]).mrrAt5,null);
});

test('a matching case id with the wrong year, official source or location cannot score',async()=>{
  const {questions,judgments}=await loadSuite();
  const gold=judgments[0].expected[0];
  const match={...gold,evidence:[{case_id:gold.case_id,location:gold.location}]};
  const response={matches:[match],match_status:'matched',requires_verification:true,semantic_used:true};
  assert.equal(gradeFirstResponse(response,judgments[0],questions[0],5).rank,1);
  for (const change of [{source_url:'https://example.invalid/'},{year:1900},{evidence:[{case_id:gold.case_id,location:'p:1'}]}]) {
    assert.equal(gradeFirstResponse({...response,matches:[{...match,...change}]},judgments[0],questions[0],5).rank,null);
  }
  assert.throws(()=>gradeFirstResponse({...response,matches:[match,match]},judgments[0],questions[0],5));
});
