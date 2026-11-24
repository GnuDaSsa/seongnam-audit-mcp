import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuditCore } from '../core.mjs';

// Synthetic public-text fixtures keep the ranking regression runnable without downloading private assets.
const examples = [
  ['split', '단일물품 분할 구매 부적정', '동일한 물품을 분할구매하고 같은 업체와 수의계약을 체결한 사실이 확인됨.'],
  ['electrical', '전기공사 미분리발주', '전기공사를 다른 공종과 함께 발주하여 분리발주 의무를 지키지 않은 사실이 확인됨.'],
  ['education', '마약류 취급 미이수업체 관리 소홀', '의무교육을 이수하지 않은 업체에 대한 관리 업무를 제대로 처리하지 않은 사실이 있음.'],
  ['weather', '공사 감독 확인 소홀', '시공 당일 강수가 관측되었다. 구청에서는 검토 자료를 보관하지 않았다.'],
];

function fixture(ranker) {
  const sources = examples.map(([id, title]) => ({ id, title, format: 'html', url: 'https://example.org/' + id, sha256: 'a'.repeat(64) }));
  const cases = examples.map(([id, title]) => ({ id, title, source_id: id, agency: '가상기관', year: 2023, category: '연습', locations: ['html:body'] }));
  const pages = Object.fromEntries(examples.map(([id,,body]) => [id, { 'html:body': body }]));
  const data = { sources, cases, pages, coverage: { scope: 'synthetic' } };
  return createAuditCore({
    loadSet: async set => set === 'city' ? data : null,
    ranker,
    readSource: async source => ({ pages: pages[source.id], sha256: source.sha256, title: source.title }),
  });
}

for (const [name, ranker] of [
  ['lexical fallback', null],
  ['semantic reranker', (query, rows) => new Map(rows.map(row => [row.id, row.id === 'education' ? 1 : 0]))],
]) {
  test(name + ' requires subject evidence even with administrative filler or unrelated matching words', async () => {
    const service = await fixture(ranker);
    for (const query of ['이거 감사에 걸릴지 확인해 주세요', '목성의 메탄 동위원소비 분광 관측', '제가 업무를 정상적으로 처리했는지 한번 봐주세요']) {
      const response = await service.research({ query });
      assert.equal(response.match_status, 'no_match', query);
      assert.deepEqual(response.matches, []);
    }
  });

  test(name + ' distinguishes split purchases and mandatory separate procurement of electrical work', async () => {
    const service = await fixture(ranker);
    for (const [query, expected] of [
      ['같은 업체에 같은 물건을 두 번 나눠서 주문한 건', 'split'],
      ['전기공사를 다른 공종과 분리하지 않고 발주했어', 'electrical'],
    ]) {
      const { matches } = await service.research({ query });
      assert.equal(matches[0].case_id, expected);
      const checked = await service.verify({ evidence: matches[0].evidence });
      assert.ok(checked.verified);
      assert.equal(checked.case_contexts[0].case_id, expected);
    }
  });
}

test('shared verification fails closed if the source reader supplies another source hash or case title', async () => {
  const text = '납품기한을 두 차례 연장한 사실이 확인됨.';
  const pages = { 'html:body': text };
  const source = { id: 's', title: '납품 지연', format: 'html', sha256: 'a'.repeat(64) };
  const item = { id: 'case', title: source.title, source_id: source.id, locations: ['html:body'] };
  const data = { sources: [source], cases: [item], pages: { s: pages } };
  for (const fresh of [{ sha256: 'b'.repeat(64), title: source.title }, { sha256: source.sha256, title: '다른 사례' }]) {
    const service = await createAuditCore({
      loadSet: async set => set === 'city' ? data : null,
      readSource: async () => ({ pages, ...fresh }),
    });
    const result = await service.verify({ evidence: [{ case_id: item.id, location: 'html:body', quote: text }] });
    assert.equal(result.verified, false);
    assert.deepEqual(result.case_contexts, []);
  }
});

test('focused original requires the requested text on the freshly read case location', async () => {
  const service = await fixture(null);
  const location = { case_id: 'split', location: 'html:body' };
  const good = await service.original({ ...location, focus: '동일한\n 물품을 분할구매하고' });
  assert.equal(good.verified, true);
  assert.ok(good.locations[0].text.includes('사실이 확인됨.'));
  for (const focus of ['다른 공종과 함께 발주하여', '  ']) {
    const bad = await service.original({ ...location, focus });
    assert.deepEqual(bad, { verified: false, error: 'focus_not_in_original' });
  }
});
