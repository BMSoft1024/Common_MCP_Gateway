import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 15251;
const BASE = `http://127.0.0.1:${PORT}`;

let tempDir;
let configPath;
let catalogPath;
let child;

const seedConfig = () => ({
  'common-mcp': {
    version: '1.0.0',
    globalDefaults: { timeout: 30000, retryAttempts: 3 },
    downstreamServers: {
      alpha: { command: 'npx', args: ['-y', 'alpha'], retries: 2, healthCheck: { enabled: true } },
      beta: { command: 'node', args: [] }
    },
    gate: { knownProjects: { 'p-1': 'C:/proj/one' }, unknownProjectDefaults: { defaultAllow: true } },
    logging: { level: 'INFO' }
  }
});

const readConfig = () => JSON.parse(readFileSync(configPath, 'utf-8'))['common-mcp'];
const call = (path, init) => fetch(`${BASE}${path}`, init);
const put = (path, body) =>
  call(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'gm-test-'));
  configPath = join(tempDir, 'config.json');
  catalogPath = join(tempDir, 'tool-catalog.json');
  writeFileSync(configPath, JSON.stringify(seedConfig()));
  child = spawn(process.execPath, ['-r', 'ts-node/register', 'src/server.ts'], {
    cwd: backendDir,
    env: { ...process.env, PORT: String(PORT), COMMON_MCP_CONFIG: configPath, COMMON_MCP_TOOL_CATALOG: catalogPath },
    stdio: 'ignore'
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await call('/api/status')).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('backend did not start');
});

after(() => {
  child?.kill();
  rmSync(tempDir, { recursive: true, force: true });
});

test('saving a server preserves gate, logging and unknown server fields', async () => {
  const res = await put('/api/config/server/beta', { command: 'node', args: ['x.js'], timeout: 5000 });
  assert.equal(res.status, 200);
  const cfg = readConfig();
  assert.deepEqual(cfg.gate.knownProjects, { 'p-1': 'C:/proj/one' });
  assert.equal(cfg.logging.level, 'INFO');
  assert.deepEqual(cfg.downstreamServers.alpha.healthCheck, { enabled: true });
  assert.deepEqual(cfg.downstreamServers.beta.args, ['x.js']);
});

test('legacy retries is normalized to retryAttempts on save', async () => {
  const res = await put('/api/config/server/alpha', { command: 'npx', retries: 4 });
  assert.equal(res.status, 200);
  const alpha = readConfig().downstreamServers.alpha;
  assert.equal(alpha.retryAttempts, 4);
  assert.equal('retries' in alpha, false);
});

test('invalid server payload is rejected with a readable message and does not change the file', async () => {
  const before = readFileSync(configPath, 'utf-8');
  const res = await put('/api/config/server/alpha', { command: 'npx', timeout: 5 });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /timeout/);
  assert.equal(readFileSync(configPath, 'utf-8'), before);
});

test('toggle flips disabled and keeps the rest of the file', async () => {
  const res = await call('/api/config/server/beta/toggle', { method: 'PATCH' });
  assert.deepEqual(await res.json(), { success: true, disabled: true });
  assert.ok(readConfig().gate);
  assert.equal((await call('/api/config/server/nope/toggle', { method: 'PATCH' })).status, 404);
});

test('changes made by another process are not overwritten by a later save', async () => {
  const external = JSON.parse(readFileSync(configPath, 'utf-8'));
  external['common-mcp'].gate.knownProjects['p-2'] = 'C:/proj/two';
  writeFileSync(configPath, JSON.stringify(external));
  await put('/api/config/server/beta', { command: 'node', args: [] });
  assert.equal(readConfig().gate.knownProjects['p-2'], 'C:/proj/two');
});

test('delete removes the server, unknown id is 404', async () => {
  assert.equal((await call('/api/config/server/beta', { method: 'DELETE' })).status, 200);
  assert.equal(readConfig().downstreamServers.beta, undefined);
  assert.equal((await call('/api/config/server/beta', { method: 'DELETE' })).status, 404);
});

test('status and tool catalog endpoints report a missing and a present catalog', async () => {
  assert.equal((await (await call('/api/tool-catalog')).json()).exists, false);
  writeFileSync(catalogPath, JSON.stringify({ generatedAt: '2026-01-01T00:00:00.000Z', servers: [], tools: [] }));
  const catalog = await (await call('/api/tool-catalog')).json();
  assert.equal(catalog.exists, true);
  const status = await (await call('/api/status')).json();
  assert.equal(status.toolCatalogGeneratedAt, '2026-01-01T00:00:00.000Z');
  assert.ok(existsSync(`${configPath}.bak`));
});

test('reserved and malformed server ids are rejected without touching the file', async () => {
  const before = readFileSync(configPath, 'utf-8');
  for (const id of ['__proto__', 'constructor', 'bad.name']) {
    const res = await put(`/api/config/server/${id}`, { command: 'node' });
    assert.equal(res.status, 400, id);
  }
  assert.equal(readFileSync(configPath, 'utf-8'), before);
});

test('whole-config overwrite endpoint no longer exists', async () => {
  const res = await call('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 'common-mcp': { downstreamServers: {} } })
  });
  assert.ok(res.status === 404 || res.status === 405);
  assert.ok(readConfig().gate);
});

test('foreign Origin and foreign Host headers are rejected', async () => {
  const foreignOrigin = await call('/api/config', { headers: { Origin: 'http://evil.example' } });
  assert.equal(foreignOrigin.status, 403);
  const status = await new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: PORT, path: '/api/config', headers: { Host: 'evil.example' } }, (r) => {
      r.resume();
      resolve(r.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 403);
  assert.equal((await call('/api/config', { headers: { Origin: 'http://localhost:5173' } })).status, 200);
});
