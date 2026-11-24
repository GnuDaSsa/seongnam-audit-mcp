import assert from 'node:assert/strict';
import test from 'node:test';
import {createAuditCore} from '../core.mjs';

const rows = [
  ['solar','공사 자재 관리','공사기간과 콘크리트의 강도에 영향을 미치는 날씨를 기록하였다.'],
  ['music','문화행사 운영','바이올린 활에 바르는 송진 양이 음색에 미치는 영향을 강사가 설명했다.'],
  ['education','교육비 집행','분할구매한 물품은 구매조서에 적은 수량과 다르게 집행했다.'],
];
async function lookup(query) {
  const cases = rows.map(([id,title]) => ({id,source_id:id,title,locations:['html:body']}));
  const data = {
    cases, sources:cases.map(item=>({id:item.id,title:item.title})), coverage:{},
    pages:Object.fromEntries(rows.map(([id,,text])=>[id,{'html:body':text}])),
  };
  const engine = await createAuditCore({loadSet:async set=>set==='city'?data:null});
  return (await engine.research({query})).matches.map(row=>row.case_id);
}
test('a shared generic phrase alone does not match a long narrative; actual subject evidence still does', async () => {
  const ids = await lookup('바이올린 활에 바르는 송진 양이 배음에 미치는 영향을 설명해 주세요.');
  assert.deepEqual(ids,['music']);
  assert.deepEqual(await lookup('화분의 뿌리가 기공 증산량에 미치는 영향을 설명해 주세요.'),[]);
});
test('a focused short query, a specific long term and an established audit term still retrieve cases', async () => {
  assert.ok((await lookup('강도 영향')).includes('solar'));
  assert.ok((await lookup('음악 대신 임시로 쓰는 콘크리트의 구조적인 과정을 연구했습니다.')).includes('solar'));
  assert.ok((await lookup('종이를 전부 다른 곳에서 따로 여러 번 나눠서 주문했어요.')).includes('education'));
});
