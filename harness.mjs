import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine } from './engine.mjs';

const project = dirname(fileURLToPath(import.meta.url));
const suite = JSON.parse(await readFile(join(project, 'test-cases.json'), 'utf8'));
const policy = JSON.parse(await readFile(join(project, 'config', 'policy.json'), 'utf8'));
const engine = await createEngine(project);
const results = [];

async function check(name, run) {
  try {
    await run();
    results.push({ name, passed: true });
    console.log('PASS', name);
  } catch (error) {
    results.push({ name, passed: false });
    console.error('FAIL', name, '-', error.message);
  }
}

function evidence({ case_id, location, quote }) {
  return { case_id, location, quote };
}

function normalizeText(text) {
  return text.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function assertCoverage(response) {
  assert.ok(response.coverage && Object.keys(response.coverage).length, '수록 범위 누락');
}

function assertNoMatch(response) {
  assert.equal(response.match_status, 'no_match');
  assert.deepEqual(response.matches, []);
  assertCoverage(response);
}

async function assertVerified(service, citations) {
  const checked = await service.verify({ evidence: citations });
  assert.equal(checked.verified, true, '최종 원문 대조 실패');
  assert.equal(checked.evidence.length, citations.length);
  for (const citation of citations) {
    const result = checked.evidence.find((item) => item.case_id === citation.case_id &&
      item.location === citation.location && normalizeText(item.quote) === normalizeText(citation.quote));
    assert.ok(result?.verified, '검증 성공한 개별 근거 누락');
    assert.ok(normalizeText(result.context).includes(normalizeText(citation.quote)), '인용과 전후 문맥 불일치');
    assert.equal(new URL(result.source_url).protocol, 'https:');
  }
}

const agency = suite.agency;
const year = suite.year;
const anchor = suite.cases.find((item) => item.id === 'holiday');
const known = evidence(anchor);

await check('status / 수록 범위 공개', async () => {
  const status = await engine.status();
  assertCoverage(status);
  const groups = Object.values(status.coverage);
  assert.equal(groups.reduce((total, group) => total + group.cases, 0), status.case_count);
  assert.ok(status.searchable_cases <= status.case_count);
  assert.ok(status.coverage.foundation.cases >= 8);
  assert.ok(status.coverage.city.cases > 0, '시청 게시물 본문 미수록');
  assert.equal(status.coverage.province.available, status.coverage.province.cases > 0);
});

for (const item of suite.cases) {
  await check(`research → original → verify / ${item.id}`, async () => {
    const expectedAgency = item.agency ?? agency;
    const expectedYear = item.year ?? year;
    const response = await engine.research({ query: item.query, agency: expectedAgency, year: expectedYear, limit: 3 });
    assert.equal(response.match_status, 'matched');
    assert.equal(response.requires_verification, true, '검색 응답에 최종 검증 요구 누락');
    assertCoverage(response);
    const match = response.matches.find((candidate) => candidate.case_id === item.case_id);
    assert.ok(match, `상위 3건에 ${item.case_id} 없음`);
    assert.equal(match.agency, expectedAgency);
    assert.equal(match.year, expectedYear);
    assert.ok(match.evidence?.length, '검색 결과의 인용 후보 없음');
    const original = await engine.original({ case_id: match.case_id });
    assert.equal(original.verified, true);
    assert.equal(original.source_url, match.source_url);
    const citations = [evidence(item), evidence(match.evidence[0])];
    for (const citation of citations) {
      const source = original.locations.find((page) => page.location === citation.location);
      assert.ok(source, '원문 위치 불일치');
      assert.ok(normalizeText(source.text).includes(normalizeText(citation.quote)), '인용이 원문에 없음');
    }
    await assertVerified(engine, citations);
  });
}

await check('기관·연도 미지정 질문 / 추석 격려물품 사후계획', async () => {
  const response = await engine.research({ query: anchor.query, limit: 5 });
  assert.ok(response.matches.some((match) => match.case_id === known.case_id), '상위 5건에 p:14 처분요구서가 없음');
});

for (const test of suite.no_match) {
  await check(`no_match / ${test.id}`, async () => {
    assertNoMatch(await engine.research({ query: test.query }));
  });
}

await check('filters / 지정 기관·연도·분야와 최대 건수 준수', async () => {
  const response = await engine.research({ query: anchor.query, agency, year, category: '회계', limit: 1 });
  assert.equal(response.matches.length, 1);
  const [match] = response.matches;
  assert.deepEqual([match.case_id, match.agency, match.year, match.category], [known.case_id, agency, year, '회계']);
  for (const filters of [{ agency: '가상회귀검증전용기관' }, { year: 1901 }, { category: '가상회귀검증분야' }]) {
    assertNoMatch(await engine.research({ query: anchor.query, ...filters }));
  }
});

await check('privacy / 질문의 임의 식별자 미반환', async () => {
  const marker = 'audit-fixture-test@example.invalid';
  const response = await engine.research({ query: `${anchor.query} 내 연락처는 ${marker}입니다.` });
  assert.ok(!JSON.stringify(response).includes(marker), '질문 원문 또는 식별자가 응답에 노출됨');
});

await check('policy / 답변 전 최종 인용 대조 요구', async () => {
  assert.equal(policy.required_final_tool, 'verify_audit_evidence');
  const response = await engine.research({ query: anchor.query, agency, year });
  assert.equal(response.requires_verification, true);
  assert.ok(response.next_action.includes(policy.required_final_tool), '다음 실행할 MCP 도구 이름 불일치');
});

const wrongQuote = { ...known, quote: '명절 격려물품은 자체계획이 없어도 언제나 적법하다고 확인하였다.' };
const invalidInputs = [
  ['근거 없음', []],
  ['공백 인용', [{ ...known, quote: '   ' }]],
  ['원문에 없는 주장', [wrongQuote]],
  ['긍정·오류 인용 혼합', [known, wrongQuote]],
  ['다른 쪽수', [{ ...known, location: 'p:15' }]],
  ['다른 처분요구서의 쪽 도용', [{ ...known, case_id: 'foundation-2018-06' }]],
  ['존재하지 않는 사례', [{ ...known, case_id: 'missing-audit-case' }]],
];
for (const [label, citations] of invalidInputs) {
  await check(`verify 거부 / ${label}`, async () => {
    const checked = await engine.verify({ evidence: citations });
    assert.equal(checked.verified, false, '근거가 부족한 인용 묶음이 통과함');
  });
}

await check('integrity / 처음 검증한 뒤 원본이 바뀌면 같은 인용도 거부', async () => {
  const tempRoot = await realpath(tmpdir());
  const sandbox = await mkdtemp(join(tempRoot, 'seongnam-audit-harness-'));
  try {
    await Promise.all(['snapshot/foundation.json', 'snapshot/foundation-pages.json'].map((file) =>
      cp(join(project, file), join(sandbox, file))));
    const source = 'originals/foundation/2018.pdf';
    await cp(join(project, source), join(sandbox, source));
    const testEngine = await createEngine(sandbox);
    await assertVerified(testEngine, [known]);
    const raw = await readFile(join(sandbox, source));
    raw[raw.length - 1] ^= 1;
    await writeFile(join(sandbox, source), raw);
    assert.equal((await testEngine.verify({ evidence: [known] })).verified, false);
    assert.equal((await testEngine.original({ case_id: known.case_id, location: known.location })).verified, false);
  } finally {
    const target = await realpath(sandbox);
    assert.ok(dirname(target) === tempRoot && basename(target).startsWith('seongnam-audit-harness-'));
    await rm(target, { recursive: true, force: true });
  }
});

const passed = results.filter((result) => result.passed).length;
console.log(`\n${passed}/${results.length} checks passed`);
if (passed !== results.length) process.exitCode = 1;
