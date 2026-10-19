// End-to-end test: real bridge, real shared daemon, real downstream process, isolated HOME and port.
// Run with `npm run test:e2e` (builds the sources into a temporary folder first, the repo's dist/ is not touched).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const PORT = '47998';
const SESSION_TTL_MS = '2500';
let root, home, projA, projOther, policyFile, build, vA, vB, tools;
const open = [];

const readToken = () => readFileSync(join(home, '.common-mcp', 'daemon.token'), 'utf8').trim();
const health = async () => (await fetch(`http://127.0.0.1:${PORT}/health`, { headers: { Authorization: `Bearer ${readToken()}` } })).json();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitUntil(condition, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await sleep(200);
  }
  return false;
}
const names = async (client) => (await client.listTools()).tools.map((t) => t.name);
const text = (result) => result.content?.[0]?.text ?? '';

async function connect(installDir, cwd, extraEnv = {}) {
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    COMMON_MCP_PORT: PORT,
    COMMON_MCP_SESSION_TTL_MS: SESSION_TTL_MS,
    COMMON_MCP_DAEMON_IDLE_MS: '120000',
    ...extraEnv
  };
  for (const key of ['COMMON_MCP_CONFIG', 'COMMON_MCP_PROJECT_PATH', 'COMMON_MCP_MODE', 'COMMON_MCP_TOOLS_TTL_MS']) if (!(key in extraEnv)) delete env[key];

  const transport = new StdioClientTransport({ command: process.execPath, args: [join(installDir, 'dist', 'index.js')], cwd, env, stderr: 'pipe' });
  let stderr = '';
  transport.stderr?.on('data', (chunk) => (stderr += chunk));
  const client = new Client({ name: 'e2e', version: '1' }, { capabilities: {} });
  await client.connect(transport);
  const handle = { client, transport, stderr: () => stderr };
  open.push(handle);
  return handle;
}

async function closeAllClients() {
  for (const { client } of open.splice(0)) {
    try { await client.close(); } catch { /* already gone */ }
  }
}

async function stopDaemon() {
  try {
    const token = readToken();
    await fetch(`http://127.0.0.1:${PORT}/shutdown?forVersion=999.0.0&force=1`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  } catch { /* no daemon */ }
  for (let i = 0; i < 20; i++) {
    try { await health(); await sleep(250); } catch { return; }
  }
}

before(async () => {
  delete process.env.COMMON_MCP_TOOLS_TTL_MS;
  root = mkdtempSync(join(tmpdir(), 'cm-e2e-'));
  home = join(root, 'home');
  projA = join(root, 'projA');
  projOther = join(root, 'other');
  for (const dir of [home, projA, projOther, join(projA, '.ai'), join(home, '.common-mcp')]) mkdirSync(dir, { recursive: true });

  build = join(root, 'build');
  const tsc = spawnSync(process.execPath, [join(repo, 'node_modules', 'typescript', 'bin', 'tsc'), '--outDir', join(build, 'dist'), '--declaration', 'false', '--sourceMap', 'false', '--declarationMap', 'false'], { cwd: repo, encoding: 'utf8' });
  assert.equal(tsc.status, 0, tsc.stdout + tsc.stderr);

  for (const [dir, version] of [['vA', '9.9.1'], ['vB', '9.9.2']]) {
    mkdirSync(join(root, dir));
    cpSync(join(build, 'dist'), join(root, dir, 'dist'), { recursive: true });
    writeFileSync(join(root, dir, 'package.json'), JSON.stringify({ name: 'gateway-under-test', version }));
  }
  vA = join(root, 'vA');
  vB = join(root, 'vB');

  const nodePath = join(repo, 'node_modules');
  const config = {
    'common-mcp': {
      version: '1.0.0',
      globalDefaults: { timeout: 20000, retryAttempts: 2, retryDelay: 200, circuitBreaker: { enabled: true, failureThreshold: 5, resetTimeout: 60000 } },
      downstreamServers: {
        echo: { command: process.execPath, args: [join(repo, 'test', 'fixtures', 'echo-server.cjs')], retries: 1, env: { NODE_PATH: nodePath, ECHO_EXTRA: '1' } },
        slow: { command: process.execPath, args: [join(repo, 'test', 'fixtures', 'echo-server.cjs')], timeout: 3000, retryAttempts: 2, env: { NODE_PATH: nodePath } }
      },
      gate: { knownProjects: { pA: projA }, unknownProjectDefaults: { defaultAllow: true } },
      logging: { level: 'INFO', format: 'json', file: join(home, '.common-mcp', 'logs', 'gateway.log'), maxSize: '1MB', maxFiles: 1 }
    }
  };
  writeFileSync(join(home, '.common-mcp', 'config.json'), JSON.stringify(config, null, 2));
  policyFile = join(projA, '.ai', 'mcp_gate_policy.json');
  writeFileSync(policyFile, JSON.stringify({ version: 1, projectId: 'pA', defaultAllow: true, servers: { echo: { tools: { secret: false } } } }));

  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.NODE_PATH = nodePath;
  tools = require(join(build, 'dist', 'utils', 'tools-cache.js'));
});

after(async () => {
  await closeAllClients();
  await stopDaemon();
  rmSync(root, { recursive: true, force: true });
});

test('bridge, daemon and policy: two clients share one downstream process, policy applies per project', async () => {
  const a = await connect(vA, projA);
  const namesA = await names(a.client);
  assert.ok(namesA.includes('echo__echo'));
  assert.ok(namesA.includes('gate__set_project_context'));
  assert.ok(!namesA.includes('echo__secret'), 'policy must hide echo__secret in project A');

  const first = text(await a.client.callTool({ name: 'echo__echo', arguments: { text: 'hi' } }));
  assert.match(first, /^echo:hi:pid=\d+$/);

  await assert.rejects(a.client.callTool({ name: 'echo__secret', arguments: {} }), /not allowed/i);

  const b = await connect(vA, projOther);
  assert.ok((await names(b.client)).includes('echo__secret'), 'unknown project uses the defaults');
  const second = text(await b.client.callTool({ name: 'echo__echo', arguments: { text: 'b' } }));
  assert.equal(first.split('pid=')[1], second.split('pid=')[1], 'one shared downstream process');

  const info = await health();
  assert.equal(info.sessions, 2);
  assert.equal(info.downstream, 2, 'one connection per configured server (echo, slow), not one per session');
  assert.equal(info.version, '9.9.1');

  const unauthorized = await fetch(`http://127.0.0.1:${PORT}/mcp`, { method: 'POST' });
  assert.equal(unauthorized.status, 401);
  if (process.platform !== 'win32') assert.equal((statSync(join(home, '.common-mcp', 'daemon.token')).mode & 0o777), 0o600);
});

test('policy file changes apply live and only to the affected project', async () => {
  const [a, b] = open;
  writeFileSync(policyFile, JSON.stringify({ version: 1, projectId: 'pA', defaultAllow: true, servers: { echo: { enabled: false } } }));
  await sleep(2500);
  assert.ok(!(await names(a.client)).some((n) => n.startsWith('echo__')), 'echo disabled for project A');
  assert.ok((await names(b.client)).includes('echo__echo'), 'other project unaffected');
});

test('an old daemon is replaced by a newer bridge when no client is connected', async () => {
  await closeAllClients();
  assert.ok(await waitUntil(async () => (await health()).sessions === 0), 'all sessions closed');

  const upgraded = await connect(vB, projOther);
  assert.equal((await health()).version, '9.9.2');
  assert.ok((await names(upgraded.client)).includes('echo__echo'));
});

test('a busy older daemon is kept by a newer bridge, which says so', async () => {
  await closeAllClients();
  await stopDaemon();
  const first = await connect(vA, projOther);
  assert.equal((await health()).version, '9.9.1');

  const newer = await connect(vB, projOther);
  assert.equal((await health()).version, '9.9.1', 'the daemon with a live client must not be replaced');
  assert.match(newer.stderr(), /daemon 9.9.1 is still running/);
  assert.ok((await names(newer.client)).includes('echo__echo'), 'the newer bridge still works against the older daemon');
  assert.ok((await names(first.client)).includes('echo__echo'));
});

test('COMMON_MCP_FORCE_DAEMON_RESTART replaces a busy older daemon', async () => {
  const forced = await connect(vB, projOther, { COMMON_MCP_FORCE_DAEMON_RESTART: '1' });
  assert.equal((await health()).version, '9.9.2');
  assert.ok((await names(forced.client)).includes('echo__echo'));
});

test('an older bridge never replaces a newer idle daemon', async () => {
  await closeAllClients();
  await stopDaemon();
  await connect(vB, projOther);
  await closeAllClients();
  assert.ok(await waitUntil(async () => (await health()).sessions === 0), 'all sessions closed');
  assert.equal((await health()).version, '9.9.2');

  const older = await connect(vA, projOther);
  assert.equal((await health()).version, '9.9.2', 'no downgrade ping-pong');
  assert.doesNotMatch(older.stderr(), /still running/);
  assert.ok((await names(older.client)).includes('echo__echo'));
});

test('health only reveals details to holders of the token', async () => {
  const anonymous = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
  assert.deepEqual(anonymous, { ok: true });
});

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('a bridge recovers its session when the daemon was restarted, the client keeps working', async () => {
  await closeAllClients();
  const survivor = await connect(vA, projOther);
  const survivorPid = survivor.transport.pid;
  assert.match(text(await survivor.client.callTool({ name: 'echo__echo', arguments: { text: 'before' } })), /^echo:before:pid=\d+$/);

  await stopDaemon();
  const other = await connect(vA, projOther); // starts the new daemon
  assert.ok((await names(other.client)).includes('echo__echo'));

  // The request that finds the session gone is replayed on the recovered session, the client never sees an error.
  assert.match(text(await survivor.client.callTool({ name: 'echo__echo', arguments: { text: 'after' } })), /^echo:after:pid=\d+$/);
  assert.ok(isAlive(survivorPid), 'the bridge must stay alive');
  assert.match(survivor.stderr(), /session recovered/);
  assert.ok((await names(survivor.client)).includes('echo__echo'));
});

test('an idle bridge re-attaches to a restarted daemon without any client request', async () => {
  await closeAllClients();
  const idle = await connect(vA, projOther);
  const idlePid = idle.transport.pid;
  await stopDaemon();
  await connect(vA, projOther); // starts the new daemon: one session

  assert.ok(await waitUntil(async () => (await health()).sessions === 2, 30000), 'the idle bridge must open a new session on its own');
  assert.ok(isAlive(idlePid), 'the bridge must stay alive');
  assert.ok((await names(idle.client)).includes('echo__echo'));
});

test('a request that arrives while the daemon is gone starts a new daemon and succeeds', async () => {
  await closeAllClients();
  const { client } = await connect(vA, projOther);
  await stopDaemon();

  assert.ok((await names(client)).includes('echo__echo'), 'the bridge started a daemon for the waiting request');
  assert.equal((await health()).sessions, 1);
});

test('a session of a killed bridge is cleaned up, live sessions are kept', async () => {
  await closeAllClients();
  await sleep(500);
  const victim = await connect(vA, projOther);
  const survivor = await connect(vA, projOther);
  assert.equal((await health()).sessions, 2);

  process.kill(victim.transport.pid, 'SIGKILL');
  await sleep(Number(SESSION_TTL_MS) + 3000);

  assert.equal((await health()).sessions, 1, 'only the abandoned session is removed');
  assert.ok((await names(survivor.client)).includes('echo__echo'), 'the live client keeps working');
});

test('a client that initializes again on a live or lost session gets a working session, no restart of the bridge', async () => {
  await closeAllClients();
  await stopDaemon();

  const child = spawn(process.execPath, [join(vA, 'dist', 'index.js')], {
    cwd: projOther,
    env: { ...process.env, HOME: home, USERPROFILE: home, COMMON_MCP_PORT: PORT, COMMON_MCP_SESSION_TTL_MS: SESSION_TTL_MS, COMMON_MCP_DAEMON_IDLE_MS: '120000' },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const replies = new Map();
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line);
        if (message.id !== undefined) replies.set(message.id, message);
      } catch { /* not a reply */ }
    }
  });
  const send = (message) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  const request = async (id, method, params = {}) => {
    send({ id, method, params });
    assert.ok(await waitUntil(() => replies.has(id), 20000), `no reply to ${method} ${id}`);
    return replies.get(id);
  };
  const handshake = async (id) => {
    const reply = await request(id, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'raw', version: '1' } });
    assert.ok(reply.result, `initialize ${id} must succeed: ${JSON.stringify(reply.error)}`);
    send({ method: 'notifications/initialized' });
  };

  try {
    await handshake(1);
    assert.ok((await request(2, 'tools/list')).result.tools.some((t) => t.name === 'echo__echo'));

    // Same bridge, same live daemon session: the client restarts its handshake.
    await handshake(3);
    assert.ok((await request(4, 'tools/list')).result.tools.some((t) => t.name === 'echo__echo'));

    // The daemon lost the session (restart), then the client restarts its handshake.
    await stopDaemon();
    await handshake(5);
    assert.ok((await request(6, 'tools/list')).result.tools.some((t) => t.name === 'echo__echo'));
    assert.ok(isAlive(child.pid), 'the bridge must stay alive');
  } finally {
    child.kill();
  }
});

test('Claude Desktop lists all tools by default, the context declaration is opt-in (gate.requireContextDeclaration)', async () => {
  await closeAllClients();
  const configFile = join(home, '.common-mcp', 'config.json');
  const original = readFileSync(configFile, 'utf8');

  const listAs = async (clientName) => {
    const desktop = new Client({ name: clientName, version: '1' }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(vA, 'dist', 'index.js')],
      cwd: home,
      env: { ...process.env, HOME: home, USERPROFILE: home, COMMON_MCP_PORT: PORT, COMMON_MCP_SESSION_TTL_MS: SESSION_TTL_MS, COMMON_MCP_DAEMON_IDLE_MS: '120000' },
      stderr: 'pipe'
    });
    await desktop.connect(transport);
    open.push({ client: desktop, transport, stderr: () => '' });
    return names(desktop);
  };

  try {
    assert.ok((await listAs('claude-ai')).includes('echo__echo'), 'default: Claude Desktop sees every tool');
    await closeAllClients();

    const strict = JSON.parse(original);
    strict['common-mcp'].gate.requireContextDeclaration = true;
    writeFileSync(configFile, JSON.stringify(strict, null, 2));
    assert.deepEqual(await listAs('claude-ai'), ['gate__set_project_context'], 'strict mode: only the meta tool until the context is declared');
    await closeAllClients();
    assert.ok((await listAs('windsurf')).includes('echo__echo'), 'strict mode does not affect other clients');
  } finally {
    writeFileSync(configFile, original);
    await closeAllClients();
  }
});

test('a started downstream server refreshes the shared tools cache', async () => {
  await closeAllClients();
  await stopDaemon();

  const config = JSON.parse(readFileSync(join(home, '.common-mcp', 'config.json'), 'utf8'))['common-mcp'].downstreamServers.echo;
  const key = tools.toolsCacheKey(config);
  tools.writeToolsCache('echo', key, [{ name: 'echo', description: 'stale', inputSchema: { type: 'object' } }]);

  const client = (await connect(vA, projOther)).client;
  assert.deepEqual((await names(client)).filter((n) => n.startsWith('echo__')), ['echo__echo'], 'list answered from the (stale) cache');

  await client.callTool({ name: 'echo__echo', arguments: { text: 'spawn' } });
  assert.ok(await waitUntil(async () => (await names(client)).includes('echo__extra'), 8000), 'the spawn refreshed the cache with the current tool list');
});

test('cache lifetime is shorter for unpinned launcher commands', () => {
  const day = 24 * 60 * 60 * 1000;
  assert.equal(tools.toolsCacheTtlMs({ command: 'node', args: ['server.js'] }), day);
  assert.equal(tools.toolsCacheTtlMs({ command: 'npx', args: ['-y', '@scope/pkg@1.2.3'] }), day);
  assert.equal(tools.toolsCacheTtlMs({ command: 'npx', args: ['-y', '@scope/pkg'] }), 4 * 60 * 60 * 1000);
  assert.equal(tools.toolsCacheTtlMs({ command: 'npx.cmd', args: ['-y', 'mcp-remote', 'http://host:9101/mcp'] }), 4 * 60 * 60 * 1000);
  assert.equal(tools.toolsCacheTtlMs({ command: 'uvx', args: ['mcp-server-fetch==0.6.2'] }), day);
});

test('a late reply of a timed out attempt does not disable the timeout of its retry', async () => {
  const { client } = await connect(vA, projOther);
  // Timeout 3 s. Attempt 1 times out at 3 s, attempt 2 starts 3.2 to 4.2 s (retry delay 200 ms plus up to 1 s jitter).
  // The late reply of attempt 1 arrives at 5.2 s, always while the timer of attempt 2 is running (until 6.2 s at the
  // earliest). With one shared watchdog id that reply cancels the timer of attempt 2, which then waits for its own
  // reply and this call would SUCCEED after 8 s or more instead of timing out.
  await assert.rejects(client.callTool({ name: 'slow__slow', arguments: { ms: 5200 } }), /timed out/i);
});

test('process tree lookup returns descendants deepest first', () => {
  const { descendantsOf } = require(join(build, 'dist', 'utils', 'process-tree.js'));
  const ps = ['  1     0', ' 100     1', ' 101   100', ' 102   100', ' 103   101', ' 200     1', ' 201   200', 'garbage line', ' 100   103'].join('\n');
  assert.deepEqual(descendantsOf(100, ps), [103, 101, 102]);
  assert.deepEqual(descendantsOf(999, ps), []);
});
