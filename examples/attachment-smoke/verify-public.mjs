import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {Client, StreamableHTTPClientTransport} from '@modelcontextprotocol/client';

const endpoint = new URL('https://seongnam-audit.gnudas0923.chatgpt.site/public-mcp');
const cases = JSON.parse(await readFile(new URL('./.work/local-results.json',import.meta.url),'utf8'));
assert.deepEqual(cases.map(row=>row.format),['PNG','PDF with text','PDF without text']);
const client = new Client({name:'synthetic-attachment-smoke',version:'1.0.0'},{
  capabilities:{},versionNegotiation:{mode:{pin:'2026-07-28'}},
});
const trace = [];
const observeFetch = async (input,init) => {
  const req = new Request(input,init);
  assert.equal(new URL(req.url).href,endpoint.href);
  const body = await req.clone().text();
  assert.ok(!body.includes('4827') && !body.includes('가상 구매 검토') && !body.includes('base64'));
  if (req.headers.get('mcp-method') === 'tools/call') {
    const {params:{name,arguments:args}} = JSON.parse(body);
    if (name === 'audit_research') assert.deepEqual(args,{query:'물품구매 분할계약',limit:1});
    trace.push(name);
  }
  return fetch(req);
};
async function invoke(name,args) {
  const response = await client.callTool({name,arguments:args});
  assert.equal(response.isError,false);
  return response.structuredContent;
}
const results = [];
try {
  await client.connect(new StreamableHTTPClientTransport(endpoint,{fetch:observeFetch}));
  for (const {format,method,query,local_marker_detected,business_terms_verified} of cases) {
    assert.ok(local_marker_detected && business_terms_verified);
    const start = trace.length;
    const search = await invoke('audit_research',{query,limit:1});
    assert.equal(search.match_status,'matched');
    const {case_id,location,quote} = search.matches[0].evidence[0];
    const original = await invoke('get_audit_original',{case_id,location,focus:quote});
    assert.equal(original.verified,true);
    assert.ok(original.locations.some(x=>x.location===location && x.text.includes(quote)));
    const verified = await invoke('verify_audit_evidence',{evidence:[{case_id,location,quote}]});
    assert.equal(verified.verified,true);
    assert.equal(verified.evidence[0].sha256,original.sha256);
    assert.equal(verified.evidence[0].quote,quote);
    const calls = trace.slice(start);
    assert.deepEqual(calls,['audit_research','get_audit_original','verify_audit_evidence']);
    results.push({format,method,query,case_id,location,title:original.title,source_url:original.source_url,
      sha256:original.sha256,quote,calls,verified:true});
  }
} finally {
  await client.close();
}
const report = {checked_at:new Date().toISOString(),endpoint:endpoint.href,provider:'@modelcontextprotocol/client@2.4.0',
  scope:'Synthetic Korean one-page documents. Host file recognition and minimal query extraction were local. Public service re-read its collected official HTML bytes. No ChatGPT UI upload was exercised.',
  data_sent:'Two query terms, then only public case identifiers, location, and quote.',results};
await writeFile(new URL('./.work/public-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(results.map(({format,title,case_id,verified})=>({format,title,case_id,verified}))));
