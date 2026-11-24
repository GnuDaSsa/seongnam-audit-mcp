import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const production = 'https://seongnam-audit.gnudas0923.chatgpt.site/public-mcp';
const golden = {
  'city-2136': '조달청 소액수의계약 견적입찰로 계약한 후',
  'city-4773': '61건을 300만 원 미만으로 나누어 회계과에 계약 의뢰 없이 구입하였으며',
};
const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
const toolNames = ['audit_research', 'get_audit_original', 'get_audit_status', 'verify_audit_evidence'];

export async function checkLive(endpoint = production, request = globalThis.fetch) {
  const url = new URL(endpoint);
  if (url.pathname === '/') url.pathname = '/public-mcp';
  const checks = [];
  let serial = 0;
  const report = { endpoint: url.href, checks, counts: {} };
  const check = async (name, action) => {
    try {
      const detail = await action();
      checks.push({ name, passed: true, ...(detail ? { detail } : {}) });
    } catch (error) {
      checks.push({ name, passed: false, error: error.message.slice(0, 300) });
    }
  };
  const fetchUrl = (address, init = {}) => request(new Request(address, { signal: AbortSignal.timeout(30000), ...init }));
  async function rpc(method, params = {}) {
    const id = ++serial;
    const response = await fetchUrl(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
    assert.equal(response.status, 200, 'HTTP status');
    assert.match(response.headers.get('cache-control') ?? '', /no-store/i, 'RPC responses are private');
    const payload = await response.json();
    assert.equal(payload.id, id);
    assert.equal(payload.jsonrpc, '2.0');
    assert.ok(!payload.error, 'Unexpected JSON-RPC error');
    return payload.result;
  }
  const tool = (name, args = {}) => rpc('tools/call', { name, arguments: args });
  async function data(name, args) {
    const result = await tool(name, args);
    assert.equal(result.isError, false, name + ' returned a tool error');
    assert.ok(result.structuredContent);
    return result.structuredContent;
  }
  await check('initialize and server/discover', async () => {
    const init = await rpc('initialize', {protocolVersion:'2025-11-25', capabilities:{}, clientInfo:{name:'audit-live-check',version:'1'}});
    assert.equal(init.protocolVersion, '2025-11-25');
    assert.equal(init.serverInfo.name, 'seongnam-audit');
    const info = await rpc('server/discover');
    assert.equal(info.serverInfo.name, init.serverInfo.name);
    assert.ok(info.supportedVersions.includes(init.protocolVersion));
    assert.match(info.instructions, /verify_audit_evidence/);
    const notify = await fetchUrl(url, {method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})});
    assert.equal(notify.status, 202);
    assert.equal(await notify.text(), '');
  });
  await check('discover four read-only tools', async () => {
    const {tools} = await rpc('tools/list');
    assert.deepEqual(tools.map(x=>x.name).sort(), toolNames);
    assert.ok(tools.every(x=>x.annotations.readOnlyHint === true));
  });
  await check('HTTP and MCP report consistent public coverage', async () => {
    const status = await data('get_audit_status');
    const response = await fetchUrl(new URL('/api/status', url));
    assert.equal(response.status, 200);
    const publicStatus = await response.json();
    assert.deepEqual(publicStatus.coverage, status.coverage);
    assert.equal(publicStatus.case_count, status.case_count);
    const {city, foundation, province} = status.coverage;
    assert.equal(status.case_count, Object.values(status.coverage).reduce((sum, row) => sum + row.cases, 0));
    assert.ok(city.listed >= 1000 && city.indexed > 0, 'city corpus missing');
    assert.equal(city.indexed, city.cases);
    assert.equal(city.indexed + city.excluded_count, city.listed);
    assert.equal(status.searchable_cases, status.case_count);
    assert.equal(foundation.cases, 0, 'local-only foundation cases claimed by hosted index');
    assert.equal(province.cases, province.indexed_cases);
    assert.equal(Object.values(city.by_year).reduce((a,b) => a + b, 0), city.cases);
    return {listed:city.listed, searched:status.searchable_cases, excluded:city.excluded_count};
  });
  let evidence, originalHash;
  await check('split purchase returns known official case', async () => {
    const result = await data('audit_research', {query:'같은 사업 물품을 시기를 나눠 여러 번 수의계약으로 분할 구매했습니다. 물품구매 분할계약 문제가 있을까요?', limit:10});
    assert.equal(result.requires_verification, true);
    assert.equal(result.semantic_used, true);
    const hit = result.matches.find(row => Object.hasOwn(golden, row.case_id));
    assert.ok(hit, 'expected city-2136 or city-4773 among candidates');
    assert.equal(hit.source_url, 'https://www.seongnam.go.kr/pm030305/' + hit.case_id.slice(5));
    assert.ok(hit.evidence.length && hit.evidence.every(row=>row.quote.length <= 150));
    evidence = {case_id:hit.case_id, location:'html:body', quote:golden[hit.case_id]};
    return {case_id:hit.case_id, title:hit.title};
  });
  await check('re-open independent source in context', async () => {
    assert.ok(evidence, 'missing matching source');
    const original = await data('get_audit_original',{case_id:evidence.case_id,location:evidence.location,focus:evidence.quote});
    assert.equal(original.verified, true);
    assert.ok(original.locations.some(p=>p.location === evidence.location && p.text.includes(evidence.quote) && p.excerpt_only));
    assert.match(original.sha256, /^[a-f0-9]{64}$/);
    originalHash = original.sha256;
  });
  await check('final verifier accepts exact quote', async () => {
    assert.ok(evidence && originalHash, 'missing verified original');
    const result = await data('verify_audit_evidence',{evidence:[evidence]});
    assert.equal(result.verified, true);
    assert.equal(result.evidence[0].sha256, originalHash);
    assert.equal(result.evidence[0].quote, evidence.quote);
    assert.ok(result.evidence[0].context.includes(evidence.quote));
    assert.ok(result.evidence[0].context.length <= 190);
    assert.ok(!('case_contexts' in result));
  });
  await check('final verifier rejects a mixed batch', async () => {
    assert.ok(evidence, 'missing matching source');
    const altered = {...evidence, quote:'감사 대상에서 영구적으로 제외한다고 확약하였습니다.'};
    const result = await data('verify_audit_evidence',{evidence:[evidence,altered]});
    assert.equal(result.verified, false);
    assert.deepEqual(result.evidence.map(e=>e.verified), [true,false]);
  });
  for (const [name, query] of [['underspecified', '이거 감사 걸리나요?'], ['unrelated', '목성의 메탄 동위원소비 분광 관측']]) {
    await check(name + ' query has no evidence', async () => {
      const r = await data('audit_research',{query});
      assert.equal(r.match_status, 'no_match');
      assert.deepEqual(r.matches, []);
      assert.ok(r.assessment && r.next_action);
    });
  }
  await check('identifiers rejected without echo', async () => {
    const marker = 'audit-smoke@example.invalid';
    for (const args of [{query:'가상 연락처 ' + marker}, {query:'계약 검토', agency:marker}]) {
      const denied = await tool('audit_research',args);
      assert.equal(denied.isError, true);
      assert.ok(!JSON.stringify(denied).includes(marker));
    }
  });
  await check('raw files and snapshots are private', async () => {
    for (const path of ['/originals/city/2136.html.gz','/snapshot/city.json','/snapshot/city-pages.json','/server/index.js']) {
      const response = await fetchUrl(new URL(path,url));
      assert.equal(response.status, 404, path);
      await response.body?.cancel();
    }
  });
  report.counts = {passed:checks.filter(row=>row.passed).length, failed:checks.filter(row=>!row.passed).length, total:checks.length};
  return report;
}

async function main() {
  const target = process.argv[2] ?? production;
  let report;
  if (target === '--bundle') {
    const {default:worker} = await import('./dist/server/index.js');
    const assets = new URL('./dist/client/', import.meta.url);
    const env = { ASSETS:{ async fetch(req) {
      try { return new Response(await readFile(new URL(new URL(req.url).pathname.slice(1), assets))); }
      catch { return new Response(null,{status:404}); }
    } } };
    report = await checkLive('https://local-bundle.invalid/public-mcp', request => worker.fetch(request,env));
  } else report = await checkLive(target);
  console.log(JSON.stringify(report,null,2));
  if (report.counts.failed) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
