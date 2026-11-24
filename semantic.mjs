import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

import { dimensions, initEncoder } from './semantic-core.mjs';
const modelFiles = {
  'common.bin.gz': 'b61978ec171a1e856bcc3f5dc480127ec200c2e8534be0b73ca65d68c03d550a',
};

async function readAsset(baseDir, filename) {
  const bytes = await readFile(join(baseDir, 'model', filename));
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (modelFiles[filename] && hash !== modelFiles[filename]) throw Error('검색 모델 파일 해시가 다릅니다.');
  const raw = gunzipSync(bytes);
  if (filename === 'words.json.gz' && createHash('sha256').update(raw).digest('hex') !== '708b4f6fa9beb6166f60aa9ae091c0f686b01afd93aa13316584f917fab2fb27') throw Error('검색 어휘 해시가 다릅니다.');
  return raw;
}

export async function createSemanticRanker(baseDir) {
  const [weights, vocabulary] = await Promise.all([
    readAsset(baseDir, 'common.bin.gz'), readAsset(baseDir, 'words.json.gz'),
  ]);
  const encode = initEncoder(weights, JSON.parse(vocabulary));

  // Only official case vectors are cached. Queries are encoded per call.
  const cache = new Map();
  return function score(query, entries) {
    const q = encode(query);
    const scores = new Map();
    for (const { id, text } of entries) {
      let doc = cache.get(id);
      if (!doc || doc.text !== text) {
        doc = { text, vector: encode(text) };
        cache.set(id, doc);
      }
      let cosine = 0;
      for (let k = 0; k < dimensions; k++) cosine += q[k] * doc.vector[k];
      scores.set(id, cosine);
    }
    return scores;
  };
}
