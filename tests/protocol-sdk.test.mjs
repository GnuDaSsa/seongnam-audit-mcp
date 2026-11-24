import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport as LegacyTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const modern = '2026-07-28';
const identity = {name:'seongnam-audit-protocol-test',version:'1.0.0'};
const official = 'https://seongnam-audit.gnudas0923.chatgpt.site/public-mcp';

async function localEndpoint(t) {
  const child = spawn(process.execPath,[fileURLToPath(new URL('../server.mjs',import.meta.url)),'--http'],{
    env:{...process.env,AUDIT_PORT:'0'},windowsHide:true,stdio:['ignore','ignore','pipe'],
  });
  const exit = once(child,'close');
  const lines = createInterface({input:child.stderr});
  t.after(async () => { lines.close(); if (child.exitCode === null) child.kill(); await exit; });
  for await (const line of lines) {
    const match = line.match(/http:\/\/127\.0\.0\.1:\d+\/public-mcp/u);
    if (match) return new URL(match[0]);
  }
  throw Error('Local MCP process exited before serving.');
}

async function checkTools(client, mustHaveCases) {
  const catalog = await client.listTools();
  assert.equal(catalog.tools.length,4);
  for (const tool of catalog.tools) {
    assert.equal(tool.annotations.readOnlyHint,true);
    assert.equal(tool.outputSchema.type,'object');
  }
  async function invoke(name,args) {
    const result = await client.callTool({name,arguments:args});
    assert.equal(result.isError,false);
    assert.deepEqual(result.structuredContent,JSON.parse(result.content[0].text));
    return result.structuredContent;
  }
  const status = await invoke('get_audit_status',{});
  if (mustHaveCases) assert.ok(status.searchable_cases > 0);
  const search = await invoke('audit_research',{query:'물품구매 분할계약',limit:1});
  assert.equal(search.requires_verification,true);
  if (mustHaveCases) assert.equal(search.match_status,'matched');
  const candidate = search.matches[0]?.evidence[0];
  if (candidate) {
    const {case_id,location,quote} = candidate;
    const original = await invoke('get_audit_original',{case_id,location,focus:quote.slice(0,60)});
    assert.equal(original.verified,true);
    const verified = await invoke('verify_audit_evidence',{evidence:[candidate]});
    assert.equal(verified.verified,true);
  }
  const miss = await invoke('get_audit_original',{case_id:'nonexistent-protocol-test-case'});
  assert.equal(miss.verified,false);
  const denied = await invoke('verify_audit_evidence',{evidence:[{
    case_id:'nonexistent-protocol-test-case',location:'html:body',quote:'실제 원문에서 찾을 수 없는 테스트 인용 문장',
  }]});
  assert.equal(denied.verified,false);
}

test('official MCP SDKs exercise deployed tool contracts over Streamable HTTP', {timeout:120000}, async t => {
  const external = process.env.AUDIT_PROTOCOL_URL;
  const url = external ? new URL(external) : await localEndpoint(t);
  if (external) assert.ok(url.href === official || ['127.0.0.1','localhost'].includes(url.hostname));
  await t.test('v2.4.0 pinned to the modern stateless dialect',async () => {
    const client = new Client(identity,{capabilities:{},versionNegotiation:{mode:{pin:modern}}});
    const wire = [];
    const observeFetch = async (input,init) => {
      const request = new Request(input,init);
      const response = await fetch(request);
      if (request.headers.get('mcp-method') === 'server/discover') {
        const packet = await response.clone().json();
        wire.push({version:request.headers.get('mcp-protocol-version'),result:packet.result});
      }
      return response;
    };
    try {
      await client.connect(new StreamableHTTPClientTransport(url,{fetch:observeFetch}));
      const discovered = await client.discover();
      assert.ok(discovered.supportedVersions.includes(modern));
      const discoveryWire = wire.at(-1);
      assert.equal(discoveryWire?.version,modern,'SDK must actually speak the modern dialect');
      assert.equal(discoveryWire.result.resultType,'complete');
      assert.equal(discoveryWire.result._meta['io.modelcontextprotocol/serverInfo'].name,'seongnam-audit');
      assert.equal(discovered.cacheScope,'public');
      assert.equal(discovered.ttlMs,0);
      await checkTools(client,url.href === official);
    } finally { await client.close(); }
  });
  await t.test('v1.32.2 completes the legacy initialization handshake',async () => {
    const client = new LegacyClient(identity,{capabilities:{}});
    try {
      await client.connect(new LegacyTransport(url));
      assert.equal(client.getServerVersion().name,'seongnam-audit');
      await checkTools(client,url.href === official);
    } finally { await client.close(); }
  });
});
