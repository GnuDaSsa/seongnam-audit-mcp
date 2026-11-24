import { boundedExcerpt, createAuditCore, excerptBounds, locateQuote } from './core.mjs';
import { caseText, gunzip, sha256Hex } from './hosted-asset.mjs';
import { dimensions, initEncoder } from './semantic-core.mjs';
import { dispatchHttp } from './rpc.mjs';
import policy from './config/policy.json';

const built = /*__HOSTED_DATA__*/null;
const decoder = new TextDecoder();
const encoder = new TextEncoder();
const scope = '성남시 공식 공개 게시물에서 수집한 본문 HTML을 검색색인과 별도로 다시 읽고, 수집 당시 본문 바이트의 SHA-256과 인용 위치를 확인합니다.';
const json = (value, status = 200) => Response.json(value, {status, headers: {'cache-control':'no-store', 'x-content-type-options':'nosniff'}});
const unpack = async packed => JSON.parse(decoder.decode(await gunzip(Uint8Array.from(atob(packed), c => c.charCodeAt(0)))));

async function modelAsset(env, name, digest) {
  const r = await env.ASSETS.fetch(new Request('https://assets.local/model/' + name));
  if (!r.ok) throw Error('모델 자산 로딩 실패');
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (await sha256Hex(bytes) !== digest) throw Error('모델 자산 해시 불일치');
  return gunzip(bytes);
}

const normal = s => s.normalize('NFC').replace(/\s+/gu,' ').trim();
function excerpt(text, {maximum=145, focus='', query=''} = {}) {
  const body = normal(text);
  const limit = Math.min(maximum, Math.ceil(body.length * 0.8));
  if (focus) {
    const needle = normal(focus), match = locateQuote(body, needle);
    if (match.error || needle.length > limit) return null;
    const left = Math.max(0, Math.min(body.length - limit, match.start - Math.floor((limit - needle.length)/2)));
    return boundedExcerpt(body, left, left + limit);
  }
  // In a short excerpt prioritize the finding after an explicit transition over quotations of statutes.
  const turn = /(?:그런데|그러나|그럼에도(?:\s*불구하고)?|확인한 결과|점검한 결과|감사 결과)[,\s]/u.exec(body);
  let pivot = turn?.index;
  if (pivot === undefined && query) {
    const terms = normal(query).match(/[가-힣a-zA-Z]{2,}/g) ?? [];
    const offsets = terms.filter(w => !['부적정','지적','감사','확인','업무','소홀','처리'].includes(w))
      .map(w => body.indexOf(w)).filter(at => at >= 0);
    if (offsets.length) pivot = Math.max(0, Math.min(...offsets) - 25);
  }
  const left = Math.min(pivot ?? 0, Math.max(0, body.length - limit));
  return boundedExcerpt(body, left, left + limit);
}

export async function hostedEngine(env, bundle) {
  const sets = await unpack(bundle.catalog);
  const ordinals = new Map(sets.city.cases.map((entry, index) => [entry.id, index]));
  let model;
  async function loadModel() {
    const [weights, vocabulary, raw] = await Promise.all(['common.bin.gz','words.json.gz','vectors.bin.gz']
      .map(name => modelAsset(env, name, bundle.modelHashes[name])));
    const vectors = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    if (vectors.length !== ordinals.size * dimensions) throw Error('벡터 수와 검색 사례 수 불일치');
    return { encode: initEncoder(weights, JSON.parse(decoder.decode(vocabulary))), vectors };
  }
  async function ranker(query, candidates) {
    model ??= loadModel().catch(e => { model = undefined; throw e; });
    const {encode, vectors} = await model;
    const q = encode(query), result = new Map();
    for (const item of candidates) {
      const start = ordinals.get(item.id) * dimensions;
      let cosine = 0;
      for (let k = 0; k < dimensions; k++) cosine += vectors[start + k] * q[k];
      result.set(item.id, cosine);
    }
    return result;
  }
  const core = await createAuditCore({
    ranker, loadSet: async set => sets[set],
    readSource: async (source, locations) => {
      if (!locations.every(loc => loc === 'html:body')) return {error:'unknown_case_location'};
      // Re-open the independent source shard for every check. Nothing here reads the search index.
      const shard = await unpack(bundle.originals[source.shard]);
      const record = shard[source.id];
      if (!record || record.id !== source.id) return {error:'unknown_case'};
      const hash = await sha256Hex(encoder.encode(record.markup));
      if (hash !== source.sha256) return {error:'original_hash_mismatch'};
      return {pages:{'html:body':caseText(record.markup, bundle.entities)}, sha256:hash};
    }
  });
  return {
    status() { return {...core.status(), corpus_sha256:bundle.corpusHash, verification:scope, license_scope:'시청 공개 게시물의 짧은 근거와 공식 원문 링크를 제공합니다.'}; },
    async research(input) {
      const result = await core.research(input);
      for (const row of result.matches) {
        for (const e of row.evidence) e.quote = excerpt(e.quote,{query:input.query});
      }
      return result;
    },
    async original(input) {
      const r = await core.original(input);
      if (r.verified) {
        r.locations = r.locations.map(row => ({location:row.location, text:excerpt(row.text,{maximum:190,focus:input.focus}), excerpt_only:true})).filter(row=>row.text);
        if (!r.locations.length) return {verified:false,error:'focus_not_in_original'};
        r.verification_scope = scope;
      }
      return r;
    },
    async verify(input) {
      if (Array.isArray(input?.evidence) && input.evidence.some(e => typeof e?.quote !== 'string' || Array.from(e.quote).length > 150))
        return {verified:false, error:'공개 서비스는 150자 이하의 원문 인용을 검증합니다.', evidence:[]};
      const r = await core.verify(input);
      for (const ev of r.evidence ?? []) if (ev.verified) {
        const length = Array.from(ev.context).length;
        const maxContext = Math.min(190, Math.ceil(length * 0.85));
        if (Array.from(ev.quote).length > maxContext) return {verified:false,error:'quote_too_long_for_case',evidence:[]};
        const at = ev.quote_start_in_context;
        const start = Math.max(0, Math.min(ev.context.length - maxContext, at - Math.floor((maxContext - ev.quote.length) / 2)));
        const bounds = excerptBounds(ev.context,start,Math.min(ev.context.length,start + maxContext));
        ev.context = ev.context.slice(bounds.start, bounds.end);
        ev.quote_start_in_context = at - bounds.start;
      }
      // The official source URL accompanies every successful citation for access to the full context.
      delete r.case_contexts;
      r.verification_scope = scope;
      return r;
    }
  };
}

async function requestJson(request) {
  const maximum = 48 * 1024;
  if (Number(request.headers.get('content-length')) > maximum) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  let length = 0;
  const chunks = [];
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
}

export function workerFor(bundle) {
  let cached;
  return { async fetch(request, env) {
    const {pathname} = new URL(request.url);
    try {
      if (pathname === '/' || pathname === '/index.html') {
        return env.ASSETS.fetch(new Request('https://assets.local/index.html', {method:request.method === 'HEAD' ? 'HEAD' : 'GET'}));
      }
      if (!['/api/status','/public-mcp','/mcp'].includes(pathname)) return json({error:'not_found'},404);
      if (pathname !== '/api/status' && request.method !== 'POST') return new Response(null,{status:405,headers:{allow:'POST'}});
      if (pathname === '/api/status' && request.method !== 'GET') return new Response(null,{status:405,headers:{allow:'GET'}});
      cached ??= hostedEngine(env, bundle).catch(e => {cached = undefined; throw e;});
      const engine = await cached;
      if (pathname === '/api/status') return json(engine.status());
      let body;
      try { body = await requestJson(request); }
      catch { return json({jsonrpc:'2.0', id:null,error:{code:-32700,message:'Invalid JSON'}},400); }
      if (body === null) return json({error:'invalid_or_oversized_request'},400);
      const result = await dispatchHttp(engine, policy, body, request.headers);
      return result.body === null ? new Response(null,{status:result.status}) : json(result.body,result.status);
    } catch { return json({error:'service_unavailable'},503); }
  }};
}

export default workerFor(built);
