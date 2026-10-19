#!/usr/bin/env node
// Resilient stdio <-> Streamable HTTP MCP bridge.
//
// Replaces `npx mcp-remote <url>` for local HTTP MCP servers that lose their sessions (Unity domain reloads, app restarts).
// mcp-remote keeps the old session id after the server forgot it ("Failed to open SSE stream: Bad Request",
// "Maximum reconnection attempts exceeded") and stays broken until the client restarts it. This bridge builds a fresh session
// on its own: it repeats the client's `initialize` handshake on a new connection, answers requests that died with the old
// session with a retryable error, replays the request that found the session gone, and tells the client the tool list may
// have changed. The client never sees a closed connection.
//
// Usage: node resilient-http-bridge.mjs <url> [--header "Name: value"]...
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--header'));
if (!url) {
  console.error('[http bridge] usage: node resilient-http-bridge.mjs <url> [--header "Name: value"]');
  process.exit(2);
}

const headers = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--header' && args[i + 1]) {
    const [name, ...rest] = args[i + 1].split(':');
    headers[name.trim()] = rest.join(':').trim();
  }
}

const RECOVERY_WINDOW_MS = 60_000;
const RECOVERY_LIMIT = 8;
const REINIT_ATTEMPTS = 40;
const REINIT_DELAY_MS = 1500;
const REINIT_ANSWER_TIMEOUT_MS = 10_000;

const log = (text) => console.error(`[http bridge] ${text}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const stdio = new StdioServerTransport();
let remote;
let initializeRequest;
let initializedNotification;
const pending = new Set();
const forwarding = new Set();
const reinitWaiters = new Map();
const recoveries = [];
let recovering = null;
let reinitCounter = 0;
let sseFailures = 0;
let shuttingDown = false;
let streamEverWorked = false;

const replyError = (id, text) => stdio.send({ jsonrpc: '2.0', id, error: { code: -32000, message: text } });

const shutdown = async (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await Promise.race([remote?.terminateSession(), sleep(1500)]);
  } catch {
    // the server may already be gone
  }
  process.exit(code);
};

const onRemoteMessage = (message) => {
  sseFailures = 0;
  streamEverWorked = true;

  if ('id' in message && !('method' in message)) {
    const waiter = reinitWaiters.get(message.id);
    if (waiter) {
      reinitWaiters.delete(message.id);
      waiter();
      return;
    }
    pending.delete(message.id);
  }

  void stdio.send(message);
};

function createRemote() {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    reconnectionOptions: { initialReconnectionDelay: 1000, maxReconnectionDelay: 10_000, reconnectionDelayGrowFactor: 1.5, maxRetries: 2 },
    requestInit: { headers },
  });
  transport.onmessage = onRemoteMessage;
  transport.onerror = (error) => {
    if (transport !== remote || shuttingDown) return;
    log(error.message);
    // The event stream of a session the server forgot cannot be re-opened: build a new session instead of waiting for the next request.
    if (/Maximum reconnection attempts|Failed to reconnect SSE|Bad Request|404/.test(error.message) && streamEverWorked && ++sseFailures >= 2) {
      void recoverOrExit();
    }
  };
  transport.onclose = () => {
    if (transport === remote && !shuttingDown && !recovering) void recoverOrExit();
  };
  return transport;
}

async function reinitialize(fresh) {
  if (!initializeRequest) return;
  const reinitId = `bridge-reinit-${++reinitCounter}`;
  const answered = new Promise((resolve, reject) => {
    reinitWaiters.set(reinitId, resolve);
    setTimeout(() => reject(new Error('no answer to the re-initialize request')), REINIT_ANSWER_TIMEOUT_MS).unref();
  });
  await fresh.send({ ...initializeRequest, id: reinitId });
  await answered;
  if (initializedNotification) await fresh.send(initializedNotification);
}

function recover() {
  if (recovering) return recovering;

  recovering = (async () => {
    const now = Date.now();
    while (recoveries.length && now - recoveries[0] > RECOVERY_WINDOW_MS) recoveries.shift();
    if (recoveries.length >= RECOVERY_LIMIT) throw new Error(`more than ${RECOVERY_LIMIT} recoveries in a minute`);
    recoveries.push(now);

    log('session lost, recovering');
    for (const id of [...pending]) {
      if (forwarding.has(id)) continue;
      void replyError(id, 'The server session was reset while this request was running, please retry it');
      pending.delete(id);
    }
    sseFailures = 0;

    let lastError;
    for (let attempt = 1; attempt <= REINIT_ATTEMPTS; attempt++) {
      const fresh = createRemote();
      try {
        await fresh.start();
        await reinitialize(fresh);
        const old = remote;
        remote = fresh;
        streamEverWorked = false;
        void old?.close().catch(() => undefined);
        log(`session recovered (attempt ${attempt})`);
        void stdio.send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
        return;
      } catch (error) {
        lastError = error;
        void fresh.close().catch(() => undefined);
        await sleep(REINIT_DELAY_MS);
      }
    }
    throw lastError ?? new Error('the server does not answer');
  })().finally(() => {
    recovering = null;
  });

  return recovering;
}

function recoverOrExit() {
  return recover().catch((error) => {
    log(`could not recover the session (${error.message}), exiting so the client can restart the bridge`);
    return shutdown(1);
  });
}

const isRecoverable = (error) => error?.code === undefined || [400, 404, 401, 502, 503].includes(error.code);

async function forward(message) {
  const isRequest = 'id' in message && 'method' in message;
  const id = message.id;

  if ('method' in message) {
    if (message.method === 'initialize' && isRequest) initializeRequest = message;
    else if (message.method === 'notifications/initialized') initializedNotification = message;
  }

  if (isRequest) {
    pending.add(id);
    forwarding.add(id);
  }

  try {
    if (recovering) await recovering;

    try {
      await remote.send(message);
    } catch (error) {
      if (!isRecoverable(error)) throw error;
      // The request never reached a live session, so it is safe to send it again on the recovered one.
      await recover();
      await remote.send(message);
    }
  } catch (error) {
    pending.delete(id);
    if (isRequest) void replyError(id, `MCP server unreachable: ${error.message}`);
    else log(`could not forward a notification: ${error.message}`);
  } finally {
    forwarding.delete(id);
  }
}

remote = createRemote();
stdio.onmessage = (message) => void forward(message);
stdio.onclose = () => void shutdown(0);
process.stdin.on('end', () => void shutdown(0));
process.stdin.on('close', () => void shutdown(0));

await remote.start();
await stdio.start();
log(`bridging stdio to ${url}`);
