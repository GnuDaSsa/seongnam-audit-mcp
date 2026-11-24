import { spawn } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSemanticRanker } from './semantic.mjs';

import { createAuditCore } from './core.mjs';

const extractionScript = fileURLToPath(new URL('./pipeline/read_original.py', import.meta.url));

function readFresh(request) {
  return new Promise(resolve => {
    const binary = process.env.AUDIT_PYTHON || 'python';
    const child = spawn(binary, [extractionScript], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks = [];
    let size = 0;
    const timeout = setTimeout(() => child.kill(), 30000);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 24 * 1024 * 1024) child.kill();
      else chunks.push(chunk);
    });
    child.on('error', () => { clearTimeout(timeout); resolve({ error: 'python_unavailable' }); });
    child.stdin.on('error', () => {}); // Start failures surface through the child error/close event.
    child.on('close', code => {
      clearTimeout(timeout);
      if (code !== 0) return resolve({ error: 'original_extraction_failed' });
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { resolve({ error: 'original_extraction_failed' }); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

const loadJson = async filename => JSON.parse((await readFile(filename, 'utf8')).replace(/^\uFEFF/u, ''));

export async function createEngine(baseDir) {
  const base = await realpath(baseDir);
  async function loadSet(set) {
    let data;
    try { data = await loadJson(path.join(base, 'snapshot', set + '.json')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return null;
    }
    const originalPages = (data.cases?.length || data.sources?.length)
      ? await loadJson(path.join(base, 'snapshot', set + '-pages.json')) : {};
    return { ...data, pages: originalPages };
  }
  async function readSource(source, locations) {
    try {
      const asset = await realpath(path.resolve(base, source.asset));
      const relative = path.relative(base, asset);
      if (path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep) || !relative.length) {
        return { error: 'invalid_original_path' };
      }
      return readFresh({
        asset, format: source.format, sha256: source.sha256, original_sha256: source.original_sha256,
        locations: [...locations],
      });
    } catch { return { error: 'original_read_failed' }; }
  }
  let ranker = null;
  try { ranker = await createSemanticRanker(base); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return createAuditCore({ loadSet, readSource, ranker });
}
