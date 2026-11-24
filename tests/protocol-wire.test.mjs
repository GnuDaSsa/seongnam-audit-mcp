import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatch, dispatchHttp } from '../rpc.mjs';

const version = '2026-07-28';
const policy = {privacy_rules:[],citation_rules:[],research_rules:[]};
const engine = {status:() => ({case_count:2,searchable_cases:2,source_count:2,coverage:{}})};
const meta = protocolVersion => ({
  'io.modelcontextprotocol/protocolVersion':protocolVersion,
  'io.modelcontextprotocol/clientCapabilities':{},
});
const packet = (method,params={},v=version) => ({jsonrpc:'2.0',id:'round-trip',method,params:{...params,_meta:meta(v)}});
const headers = (method,name,v=version) => new Headers({
  'mcp-protocol-version':v,'mcp-method':method,...(name ? {'mcp-name':name} : {}),
});
const send = (body,envelope) => dispatchHttp(engine,policy,body,envelope);

test('discovery and lists expose revision-specific cache and identity metadata',async () => {
  for (const method of ['server/discover','tools/list']) {
    const response = await send(packet(method),headers(method));
    assert.equal(response.status,200);
    assert.equal(response.body.result.resultType,'complete');
    assert.equal(response.body.result.cacheScope,'public');
    assert.equal(response.body.result.ttlMs,0);
    assert.equal(response.body.result._meta['io.modelcontextprotocol/serverInfo'].name,'seongnam-audit');
  }
  const legacy = await dispatch(engine,policy,{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25'}});
  assert.equal(legacy.result.protocolVersion,'2025-11-25');
  assert.equal(legacy.result.resultType,undefined);
});

test('HTTP version and method errors use the modern JSON-RPC error and status',async () => {
  const future = '2099-01-01';
  const unsupported = await send(packet('tools/list',{},future),headers('tools/list',null,future));
  assert.equal(unsupported.status,400);
  assert.equal(unsupported.body.error.code,-32022);
  assert.equal(unsupported.body.error.data.requested,future);
  assert.ok(unsupported.body.error.data.supported.includes(version));
  const missing = await send(packet('prompts/list'),headers('prompts/list'));
  assert.equal(missing.status,404);
  assert.equal(missing.body.error.code,-32601);
});

test('modern HTTP envelopes require the version, method, and tool name to match',async () => {
  const method = 'tools/call';
  const name = 'get_audit_status';
  const request = packet(method,{name,arguments:{}});
  for (const key of ['mcp-protocol-version','mcp-method','mcp-name']) {
    const missing = headers(method,name);
    missing.delete(key);
    assert.equal((await send(request,missing)).body.error.code,-32020,key);
    const mismatch = headers(method,name);
    mismatch.set(key,'unexpected-field-value');
    const r = await send(request,mismatch);
    assert.equal(r.status,400);
    assert.equal(r.body.error.code,-32020,key);
  }
  const encoded = headers(method,'=?base64?' + btoa(name) + '?=');
  assert.equal((await send(request,encoded)).body.result.structuredContent.case_count,2);
  const missingCapabilities = packet(method,{name});
  delete missingCapabilities.params._meta['io.modelcontextprotocol/clientCapabilities'];
  assert.equal((await send(missingCapabilities,headers(method,name))).body.error.code,-32602);
});
