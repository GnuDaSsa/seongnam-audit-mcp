import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import worker from '../dist/server/index.js';

const assets = new URL('../dist/client/',import.meta.url);
const env = {ASSETS:{async fetch(request) {
  return new Response(await readFile(new URL(new URL(request.url).pathname.slice(1),assets)));
}}};
async function tool(name,args) {
  const req = new Request('https://audit.example/public-mcp',{method:'POST',
    headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});
  const json = await (await worker.fetch(req,env)).json();
  assert.equal(json.result.isError,false);
  return json.result.structuredContent;
}

test('official city-4773 rejects an altered count and relocates the verified original', async () => {
  const location = {case_id:'city-4773',location:'html:body'};
  const exact = '61건을 300만 원 미만으로 나누어 회계과에 계약 의뢰 없이 구입하였으며';
  const altered = exact.slice(1);
  const result = await tool('verify_audit_evidence',{evidence:[{...location,quote:exact}]});
  assert.equal(result.verified,true);
  const hit = result.evidence[0];
  assert.equal(hit.context.slice(hit.quote_start_in_context,hit.quote_start_in_context+exact.length),exact);
  const invalid = await tool('verify_audit_evidence',{evidence:[{...location,quote:altered}]});
  assert.equal(invalid.verified,false);
  assert.equal(invalid.evidence[0].error,'quote_cuts_numeric_expression');
  assert.equal((await tool('get_audit_original',{...location,focus:altered})).verified,false);
  const original = await tool('get_audit_original',{...location,focus:exact});
  assert.ok(original.verified);
  assert.ok(original.locations[0].text.includes(exact));
  assert.ok(original.locations[0].text.length<=190);
});
