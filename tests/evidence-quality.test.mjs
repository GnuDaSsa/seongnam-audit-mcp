import assert from 'node:assert/strict';
import test from 'node:test';
import {boundedExcerpt, createAuditCore, locateQuote} from '../core.mjs';

const caseId = 'synthetic';
const location = 'html:body';
const normalized = text => text.normalize('NFC').replace(/\s+/gu,' ').trim();
const evidence = quote => ({case_id:caseId,location,quote});

async function makeEngine(text) {
  const source = {id:caseId,title:'물품 분할구매 점검',format:'html',url:'https://example.invalid/audit',sha256:'a'.repeat(64)};
  const item = {id:caseId,title:source.title,source_id:source.id,locations:[location],year:2024};
  const pages = {[location]:text};
  return createAuditCore({
    loadSet: async set => set === 'city' ? {sources:[source],cases:[item],pages:{[caseId]:pages}} : null,
    readSource: async () => ({sha256:source.sha256,title:source.title,pages}),
  });
}

test('a citation cannot turn a multi-digit count into a smaller count', async () => {
  // Regression reported for the official city-4773 case; this sentence is synthetic.
  const good = '61건을 계약담당 부서에 의뢰하지 않고 접수했다';
  const bad = good.slice(1);
  const engine = await makeEngine('공개문서에서는 ' + good + '고 밝혔다.');
  assert.equal((await engine.verify({evidence:[evidence(good)]})).verified,true);
  const mixed = await engine.verify({evidence:[evidence(good),evidence(bad)]});
  assert.equal(mixed.verified,false);
  assert.equal(mixed.evidence[1].error,'quote_cuts_numeric_expression');
  assert.deepEqual(mixed.case_contexts,[]);
  const focus = await engine.original({case_id:caseId,location,focus:bad});
  assert.equal(focus.error,'focus_cuts_numeric_expression');
});

test('currency, decimal, percent and negative signs retain their numeric meaning', async () => {
  const text = '비교하면 증감액은 −12,345.50만 원으로 확인되었다. 단가 비율은 9.25%로 정해졌다. 총액은 1억 2천만 원으로 산정되었다.';
  const engine = await makeEngine(text);
  for (const quote of ['12,345.50만 원으로 확인되었다', '345.50만 원으로 확인되었다', '50만 원으로 확인되었다',
    '비교하면 증감액은 −12,345.50', '12,345.50만 원으로 확인되었다. 단가', '천만 원으로 산정되었다',
    '2천만 원으로 산정되었다', '단가 비율은 9.25']) {
    assert.equal(locateQuote(text,quote).error,'quote_cuts_numeric_expression',quote);
  }
  const checked = await engine.verify({evidence:[evidence('증감액은 −12,345.50만 원으로 확인되었다'),evidence('단가 비율은 9.25%로 정해졌다')]});
  assert.equal(checked.verified,true);
  const years = '검토 기간은 2024-2026년입니다.';
  assert.equal(locateQuote(years,'2026년입니다.').start,years.indexOf('2026'));
  const legal = '계약 규정 제12조 3항의 내용을 확인하였다.';
  assert.equal(locateQuote(legal,'3항의 내용을 확인하였다.').start,legal.indexOf('3항'));
});

test('valid later occurrence is chosen and can be relocated from the returned context', async () => {
  const wanted = '1건을 별도로 집행한 사실이 확인되었다.';
  const text = '🗂️ 첫 검토에서는 61건을 별도로 집행한 사실이 확인되었다.\n두 번째 검토에서는\n' + wanted;
  const engine = await makeEngine(text);
  const result = await engine.verify({evidence:[evidence(wanted)]});
  assert.equal(result.verified,true);
  const row = result.evidence[0];
  assert.equal(row.quote_position.start,normalized(text).lastIndexOf(wanted));
  assert.equal(normalized(text).slice(row.quote_position.start,row.quote_position.end),wanted);
  assert.equal(row.context.slice(row.quote_start_in_context,row.quote_start_in_context+wanted.length),wanted);
  assert.equal(row.quote_start_in_context,row.context.lastIndexOf(wanted));
  assert.equal((await engine.original({case_id:caseId,location,focus:wanted})).verified,true);
});

test('suggested excerpts do not start or end inside a number', async () => {
  const short = '지급 내역은 12,345.67만 원으로 확인됐다.';
  const numberStart = short.indexOf('12'), last = short.indexOf('원')+1;
  for (let end = numberStart+1; end < last; end++) {
    assert.equal(boundedExcerpt(short,0,end),'지급 내역은');
    assert.equal(boundedExcerpt(short,end,short.length),'으로 확인됐다.');
  }
  const text = '분할구매한 사실이 확인되어 '.repeat(31) + '16,178롤과 1억 2천만 원을 집행했다. '.repeat(24);
  const engine = await makeEngine(text);
  const {matches} = await engine.research({query:'물품 분할구매'});
  assert.equal(matches.length,1);
  assert.equal((await engine.verify({evidence:matches[0].evidence})).verified,true);
});
