import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createEngine } from './engine.mjs';
import { dispatch } from './rpc.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const policy = JSON.parse(await readFile(new URL('./config/policy.json',import.meta.url),'utf8'));
const engine = await createEngine(root);
async function handle(body) {
  let request;
  try { request = JSON.parse(body); }
  catch { return {jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}}; }
  return dispatch(engine,policy,request);
}
const limit = 48 * 1024;
if (process.argv.includes('--http')) {
  const port = Number(process.env.AUDIT_PORT || 8788);
  const server = createServer(async (req,res) => {
    const send = (status,body) => { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(body === undefined ? undefined : JSON.stringify(body)); };
    const origins = [`http://127.0.0.1:${port}`,`http://localhost:${port}`];
    if (!origins.includes('http://' + req.headers.host) || req.headers.origin && !origins.includes(req.headers.origin)) return send(403);
    if (!['/mcp','/public-mcp'].includes(req.url)) return send(404);
    if (req.method !== 'POST') return send(405);
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return send(415);
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) return send(413);
      chunks.push(chunk);
    }
    const response = await handle(Buffer.concat(chunks).toString('utf8'));
    return response === null ? send(202) : send(200,response);
  });
  server.listen(port,'127.0.0.1',() => process.stderr.write(`감사 MCP http://127.0.0.1:${port}/public-mcp\n`));
} else {
  const input = createInterface({input:process.stdin,crlfDelay:Infinity});
  for await (const line of input) {
    if (!line.trim()) continue;
    const response = Buffer.byteLength(line) <= limit ? await handle(line) : {jsonrpc:'2.0',id:null,error:{code:-32600,message:'Request too large'}};
    if (response !== null) process.stdout.write(JSON.stringify(response) + '\n');
  }
}
