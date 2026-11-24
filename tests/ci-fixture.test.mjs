import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const caseId = 'city-synthetic';
const title = '복사용지 납품 검수조서 미작성 사례';
const body = '가상기관은 복사용지 납품 수량을 확인한 뒤 검수조서를 작성하도록 하였다.';
const good = { case_id: caseId, location: 'html:body', quote: '납품 수량을 확인한 뒤 검수조서를 작성하도록 하였다.' };
const bad = { ...good, quote: '감사 대상이 될 가능성이 없음을 공식 확인하였다.' };
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const privateMarker = 'quality-fixture@example.invalid';

async function createFixture(dir) {
  const modules = [
    'server.mjs', 'rpc.mjs', 'engine.mjs', 'core.mjs', 'semantic.mjs', 'semantic-core.mjs',
    'pipeline/read_original.py', 'config/policy.json',
  ];
  await Promise.all(modules.map((name) => cp(join(root, name), join(dir, name))));
  const raw = Buffer.from(`<html><body><dl class="table-line"><dt>제목</dt><dd>${title}</dd></dl><div class="board-view-content"><p>${body}</p></div></body></html>`);
  const packed = gzipSync(raw);
  const source = {
    id: caseId, title, year: 2024, authority: '가상기관', url: 'https://example.invalid/synthetic',
    format: 'html', asset: 'originals/sample.html.gz', sha256: sha(packed), original_sha256: sha(raw),
  };
  const entry = { id: caseId, source_id: caseId, title, year: 2024, agency: '가상기관', category: '계약', locations: ['html:body'] };
  const catalog = { sources: [source], cases: [entry], coverage: { indexed: 1, listed: 1 } };
  await mkdir(join(dir, 'originals'));
  await mkdir(join(dir, 'snapshot'));
  await writeFile(join(dir, source.asset), packed);
  await writeFile(join(dir, 'snapshot/city.json'), JSON.stringify(catalog));
  await writeFile(join(dir, 'snapshot/city-pages.json'), JSON.stringify({ [caseId]: { 'html:body': body } }));
  return source;
}

const rpc = (id, method, params = {}) => ({ jsonrpc: '2.0', id, method, params });
const call = (id, name, args = {}) => rpc(id, 'tools/call', { name, arguments: args });

function stdio(dir, messages) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(dir, 'server.mjs')], { cwd: dir, windowsHide: true });
    let output = '', errors = '';
    const timer = setTimeout(() => { child.kill(); reject(Error('MCP 표준 입출력 응답 시간 초과')); }, 20000);
    child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { errors += chunk; });
    child.stdin.on('error', () => {}); // A server start failure is also reported via close/error.
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(Error(`MCP 종료 코드 ${code}. ${errors}`));
      try {
        const responses = output.trim().split(/\r?\n/u).map((line) => JSON.parse(line));
        resolve({ responses: new Map(responses.map((response) => [response.id, response])), output, errors });
      } catch (error) { reject(error); }
    });
    child.stdin.end(messages.map((message) => JSON.stringify(message)).join('\n') + '\n');
  });
}

test('합성 원문을 실제 stdio 서버에서 검색하고 근거·개인정보·재검증을 검사한다', async (t) => {
  const tempRoot = await realpath(tmpdir());
  const dir = await mkdtemp(join(tempRoot, 'audit-ci-'));
  t.after(async () => {
    const target = await realpath(dir);
    assert.ok(dirname(target) === tempRoot && basename(target).startsWith('audit-ci-'));
    await rm(target, { recursive: true, force: true });
  });
  const source = await createFixture(dir);
  const policy = JSON.parse(await readFile(join(dir, 'config/policy.json'), 'utf8'));
  const request = [
    rpc(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'audit-ci', version: '1' } }),
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    rpc(2, 'tools/list'),
    call(3, 'audit_research', { query: '복사용지 납품 검수조서를 작성하지 않았습니다.' }),
    call(4, 'get_audit_original', { case_id: caseId, location: 'html:body' }),
    call(5, policy.required_final_tool, { evidence: [good] }),
    call(6, policy.required_final_tool, { evidence: [good, bad] }),
    call(7, 'audit_research', { query: '복사용지 검수 기록', agency: privateMarker }),
    call(8, 'audit_research', { query: `내 연락처는 ${privateMarker}` }),
    call(9, 'get_audit_status'),
    call(10, 'audit_research', { query: '목성 메탄 동위원소 분광' }),
  ];
  const { responses, output, errors } = await stdio(dir, request);
  assert.equal(responses.size, 10);
  assert.ok(responses.get(1).result.instructions.includes(policy.required_final_tool));
  const list = responses.get(2).result.tools;
  assert.ok(list.some((tool) => tool.name === policy.required_final_tool));
  assert.ok(list.every((tool) => tool.annotations.readOnlyHint));
  const result = (id) => responses.get(id).result;
  const retrieved = result(3).structuredContent;
  assert.equal(retrieved.matches[0].case_id, caseId);
  assert.equal(retrieved.requires_verification, true);
  assert.equal(result(4).structuredContent.locations[0].text, body);
  const checked = result(5).structuredContent;
  assert.equal(checked.verified, true);
  assert.equal(checked.evidence[0].source_url, source.url);
  assert.equal(checked.evidence[0].sha256, source.sha256);
  const mixed = result(6).structuredContent;
  assert.equal(mixed.verified, false);
  assert.deepEqual(mixed.evidence.map((item) => item.verified), [true, false]);
  assert.ok(result(7).isError && result(8).isError);
  assert.ok(!output.includes(privateMarker) && !errors.includes(privateMarker));
  assert.equal(result(9).structuredContent.case_count, 1);
  assert.equal(result(10).structuredContent.match_status, 'no_match');

  // Preserve the search snapshot and change the bytes read by the final verifier.
  await writeFile(join(dir, source.asset), gzipSync(body + ' 원문 변경'));
  const tampered = await stdio(dir, [call(1, policy.required_final_tool, { evidence: [good] })]);
  const rejected = tampered.responses.get(1).result.structuredContent;
  assert.equal(rejected.verified, false);
  assert.equal(rejected.evidence[0].error, 'original_hash_mismatch');
});
