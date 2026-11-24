import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {readFile,writeFile,mkdir,cp,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {initEncoder, dimensions} from './semantic-core.mjs';
import {caseMarkup,caseText} from './hosted-asset.mjs';
import {cityCorpusHash} from './corpus-identity.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, 'dist');
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const read = name => readFile(path.join(root, name));
const load = async name => JSON.parse(await read(name));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pack = value => gzipSync(Buffer.from(JSON.stringify(value)),{level:9}).toString('base64');
const entityMap = JSON.parse(execFileSync(process.env.AUDIT_PYTHON || 'python', ['-c', 'import html.entities,json; print(json.dumps({k[:-1]:v for k,v in html.entities.html5.items() if k.endswith(";")}))'], {encoding:'utf8'}));

const [city, pages, province] = await Promise.all(['snapshot/city.json','snapshot/city-pages.json','snapshot/province.json'].map(load));
if (!city.cases.length || city.cases.length !== city.sources.length || city.cases.length !== city.coverage.indexed)
  throw Error('수록 사례와 시청 수집 목록 불일치');
const modelHashes = {};
const [weights, vocabulary] = await Promise.all(['common.bin.gz','words.json.gz'].map(async name => {
  const bytes = await read('model/' + name);
  modelHashes[name] = hash(bytes);
  return gunzipSync(bytes);
}));
if (modelHashes['common.bin.gz'] !== 'b61978ec171a1e856bcc3f5dc480127ec200c2e8534be0b73ca65d68c03d550a' ||
    hash(vocabulary) !== '708b4f6fa9beb6166f60aa9ae091c0f686b01afd93aa13316584f917fab2fb27')
  throw Error('검색 모델 또는 어휘 체크섬 불일치');
const encode = initEncoder(weights, JSON.parse(vocabulary));
const entities = {};
const sources = [];
const originals = [];
const m = new Map(city.sources.map(s => [s.id, s]));
const vectors = new Float32Array(city.cases.length * dimensions);
let shard = {};
for (const [i, item] of city.cases.entries()) {
  const s = m.get(item.source_id);
  if (!s || !/^city-\d+$/.test(item.id) || s.id !== item.id || s.url !== 'https://www.seongnam.go.kr/pm030305/' + item.id.slice(5) ||
      s.asset !== 'originals/city/' + item.id.slice(5) + '.html.gz' || item.locations.join() !== 'html:body') throw Error('시청 원문키 불일치');
  const compressed = await read(s.asset);
  const raw = gunzipSync(compressed);
  if (hash(compressed) !== s.sha256 || hash(raw) !== s.original_sha256) throw Error('원본 해시 불일치 ' + s.id);
  const markup = caseMarkup(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  if (/<(?:input|form|script|iframe)\b|csrfToken/i.test(markup)) throw Error('본문 범위에 내부 양식 있음 ' + s.id);
  for (const match of markup.matchAll(/&([A-Za-z][a-z0-9]*);/gi)) if (Object.hasOwn(entityMap,match[1])) entities[match[1]] = entityMap[match[1]];
  const body = pages[s.id]['html:body'];
  if (caseText(markup, entities) !== body) throw Error('원문 재추출과 색인 불일치 ' + s.id);
  const sha256 = hash(Buffer.from(markup));
  const {asset,attachments,...metadata} = s;
  sources.push({...metadata, sha256, shard: originals.length});
  shard[s.id] = {id:s.id, markup};
  if (Object.keys(shard).length === 32 || i + 1 === city.cases.length) {originals.push(pack(shard)); shard = {};}
  vectors.set(encode([item.title,item.category].filter(Boolean).join(' ') + '\n' + body.trim().slice(0,2800)), i * dimensions);
}

const {skipped, ...coverage} = city.coverage;
const sets = {
  city:{ sources, cases:city.cases, pages, coverage:{...coverage, excluded_count:skipped?.length ?? 0} },
  foundation:{sources:[],cases:[],pages:{},coverage:{scope:'재단 자체감사 PDF는 로컬 자료 묶음에서 조회할 수 있습니다. 공개 서비스의 검색 범위는 성남시청의 분야별 감사사례입니다.'}},
  province:{sources:[],cases:[],pages:{},coverage:province.coverage}
};
const outModel = path.join(out,'client/model');
await mkdir(outModel,{recursive:true});
await mkdir(path.join(out,'server'),{recursive:true});
await mkdir(path.join(out,'.openai'),{recursive:true});
for (const name of ['common.bin.gz','words.json.gz']) await cp(path.join(root,'model',name),path.join(outModel,name));
const vec = gzipSync(Buffer.from(vectors.buffer));
modelHashes['vectors.bin.gz'] = hash(vec);
await writeFile(path.join(outModel,'vectors.bin.gz'),vec);
const packed = {catalog:pack(sets), originals, entities, modelHashes, corpusHash:cityCorpusHash(city,pages)};
const entry = (await read('hosted.mjs')).toString('utf8').replace('/*__HOSTED_DATA__*/null',JSON.stringify(packed));
await esbuild.build({stdin:{contents:entry,resolveDir:root,sourcefile:'hosted.mjs'},bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:path.join(out,'server/index.js')});
await cp(path.join(root,'index.html'),path.join(out,'client/index.html'));
await cp(path.join(root,'.openai/hosting.json'),path.join(out,'.openai/hosting.json'));
await writeFile(path.join(out,'server/wrangler.json'),JSON.stringify({main:'index.js',compatibility_date:'2026-11-07',assets:{directory:'../client',binding:'ASSETS',run_worker_first:true}},null,2));
// Only model binaries and the homepage may reach the public static file handler.
const actual = (await readdir(path.join(out,'client'),{recursive:true})).map(p=>p.replaceAll('\\','/')).sort();
const allowed = ['index.html','model','model/common.bin.gz','model/vectors.bin.gz','model/words.json.gz'].sort();
if (JSON.stringify(actual) !== JSON.stringify(allowed)) throw Error('예상하지 않은 공개 정적 파일. 배포 중단.');
console.log(JSON.stringify({public_cases:city.cases.length,source_shards:originals.length,worker_bytes:(await readFile(path.join(out,'server/index.js'))).length}));
