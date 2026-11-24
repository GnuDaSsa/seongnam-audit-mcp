export const dimensions = 256;

export function initEncoder(weights, vocabulary) {
  const view = new DataView(weights.buffer, weights.byteOffset, weights.byteLength);
  const count = view.getUint32(0, true);
  if (weights.length !== 4 + count * (8 + dimensions)) throw Error('검색 모델 크기가 다릅니다.');
  const offset = 4 + count * 8;
  const quantized = new Int8Array(weights.buffer, weights.byteOffset + offset, count * dimensions);
  const scales = Array.from({length: count}, (_, i) => view.getFloat32(4 + count * 4 + i * 4, true));
  const dictionary = new Map();
  let longest = 0;
  for (const [piece, score, row] of vocabulary) {
    dictionary.set(piece, { score, row });
    longest = Math.max(longest, piece.length);
  }

  function encode(text) {
    const input = '▁' + text.normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/gu, '▁');
    const scores = new Float64Array(input.length + 1).fill(-Infinity);
    const previous = new Int32Array(scores.length);
    const rows = new Int32Array(scores.length).fill(-1);
    scores[0] = 0;
    for (let i = 0; i < input.length; i++) {
      if (scores[i] - 24 > scores[i + 1]) {
        scores[i + 1] = scores[i] - 24;
        previous[i + 1] = i;
        rows[i + 1] = -1;
      }
      const end = Math.min(input.length, i + longest);
      for (let j = i + 1; j <= end; j++) {
        const token = dictionary.get(input.slice(i, j));
        if (token && scores[i] + token.score > scores[j]) {
          scores[j] = scores[i] + token.score;
          previous[j] = i;
          rows[j] = token.row;
        }
      }
    }
    const vector = new Float32Array(dimensions);
    for (let j = input.length; j > 0; j = previous[j]) {
      const row = rows[j];
      if (row < 0) continue;
      for (let k = 0; k < dimensions; k++) vector[k] += scales[row] * quantized[row * dimensions + k];
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (norm) for (let k = 0; k < dimensions; k++) vector[k] /= norm;
    return vector;
  }

  return encode;
}
