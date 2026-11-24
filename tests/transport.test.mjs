import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

async function availablePort() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

test('local MCP HTTP entry point, input bounds and privacy', { timeout: 30000 }, async t => {
  const port = await availablePort();
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs',import.meta.url)), '--http'], {
    env:{...process.env,AUDIT_PORT:String(port)}, windowsHide:true, stdio:['ignore','pipe','pipe']
  });
  const closed = once(child,'close');
  t.after(async () => { if (child.exitCode === null) child.kill(); await closed; });
  let logs = '';
  const privateEmail = 'local-transport@example.invalid';
  const url = 'http://127.0.0.1:' + port;
  child.stdout.on('data', part=>{ logs += part; });
  child.stderr.setEncoding('utf8');
  await new Promise((resolve,reject) => {
    const timer = setTimeout(()=>reject(Error('Local MCP HTTP startup timed out')), 12000);
    child.stderr.on('data', part => {
      logs += part;
      if (logs.includes(url + '/public-mcp')) { clearTimeout(timer); resolve(); }
    });
    child.once('error', error=>{ clearTimeout(timer); reject(error); });
    child.once('close', code=>{ clearTimeout(timer); reject(Error('Local MCP HTTP startup exited ' + code)); });
  });

  const json = { 'content-type':'application/json' };
  const request = (route, opts={}) => fetch(url + route, {signal:AbortSignal.timeout(5000),...opts});
  const rpc = (id,method,params={}) => JSON.stringify({jsonrpc:'2.0',id,method,params});
  for (const route of ['/public-mcp','/mcp']) {
    const response = await request(route,{method:'POST',headers:json,body:rpc(1,'initialize',{protocolVersion:'2025-11-25'})});
    assert.equal(response.status,200);
    assert.match(response.headers.get('cache-control'),/no-store/i);
    const reply = await response.json();
    assert.equal(reply.id,1);
    assert.equal(reply.result.serverInfo.name,'seongnam-audit');
  }

  const denied = await request('/mcp',{method:'POST',headers:json,
    body:rpc(2,'tools/call',{name:'audit_research',arguments:{query:'문서 담당자 ' + privateEmail}})});
  assert.equal(denied.status,200);
  const text = await denied.text();
  assert.equal(JSON.parse(text).result.isError,true);
  assert.ok(!text.includes(privateEmail));

  const badOrigin = await request('/mcp',{method:'POST',headers:{...json,origin:'https://foreign.example.invalid'},body:rpc(3,'ping')});
  assert.equal(badOrigin.status,403);
  assert.equal((await request('/mcp')).status,405);
  assert.equal((await request('/snapshot/city.json')).status,404);
  assert.equal((await request('/mcp',{method:'POST',headers:{'content-type':'text/plain'},body:rpc(3,'ping')})).status,415);
  assert.equal((await request('/mcp',{method:'POST',headers:json,body:'a'.repeat(50000)})).status,413);
  const malformed = await request('/mcp',{method:'POST',headers:json,body:'{'});
  assert.equal((await malformed.json()).error.code,-32700);
  const initialized = await request('/mcp',{method:'POST',headers:json,body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})});
  assert.equal(initialized.status,202);
  assert.equal(await initialized.text(),'');
  child.kill();
  await closed;
  assert.ok(!logs.includes(privateEmail),'local startup or request logs included a user identifier');
});
