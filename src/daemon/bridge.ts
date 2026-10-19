import { spawn } from 'child_process';
import * as path from 'path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { DAEMON_URL, GATEWAY_VERSION, daemonHealthy, daemonInfo, ensureToken, isNewerVersion, requestDaemonShutdown } from './common';

async function waitFor(condition: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition())
      return true;

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return false;
}

/**
 * Makes sure a daemon of THIS version (or a newer one) is running. A daemon left over from an older install is asked
 * to exit, which it only does while no client is connected; otherwise the bridge keeps using it (the protocol is
 * unchanged) and says so on stderr, so the update takes effect as soon as the clients are restarted. A newer daemon
 * is never replaced by an older bridge.
 * Returns false when no daemon ever answers, so the caller can fall back to the in-process gateway.
 */
async function ensureDaemon(): Promise<boolean> {
  const token = ensureToken();
  const running = await daemonInfo(token);

  if (running && (running.version === GATEWAY_VERSION || (running.version && isNewerVersion(running.version, GATEWAY_VERSION))))
    return true;

  if (running) {
    const force = process.env.COMMON_MCP_FORCE_DAEMON_RESTART === '1';
    const result = await requestDaemonShutdown(token, force);

    // 'unreachable': the daemon went away between the check and the request (another bridge is upgrading), so start one.
    if (result === 'stopped' || result === 'unreachable') {
      // Done when the old daemon is gone or a sibling bridge has already started the new one.
      await waitFor(async () => {
        const info = await daemonInfo(token);
        return info === null || info.version === GATEWAY_VERSION;
      }, 5000);

      if ((await daemonInfo(token))?.version === GATEWAY_VERSION)
        return true;
    } else {
      if (result === 'busy' || result === 'unsupported') {
        console.error(
          `[common-mcp bridge] daemon ${running.version ?? 'without version'} is still running with ${running.sessions ?? 'some'} ` +
          `client session(s), this bridge is ${GATEWAY_VERSION}. Restart all clients (or set COMMON_MCP_FORCE_DAEMON_RESTART=1) to update it.`
        );
      }

      return true;
    }
  }

  const child = spawn(process.execPath, [path.join(__dirname, 'daemon.js')], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: process.env
  });
  child.unref();

  // Wait for a daemon of this version, not for the old one that may still be answering while it shuts down.
  const ready = await waitFor(async () => (await daemonInfo(token))?.version === GATEWAY_VERSION, 20000);
  return ready || (await daemonHealthy());
}

type RequestId = string | number;

const RECOVERY_WINDOW_MS = 60 * 1000;
const RECOVERY_LIMIT = 5;

/** A daemon restart, a reaped session or a vanished daemon all look like these errors on the bridge. */
function isRecoverable(error: Error & { code?: number }): boolean {
  return error.code === undefined || error.code === 404 || error.code === 401 || error.code === 503;
}

/**
 * Thin stdio to daemon proxy. It holds no downstream server itself: it forwards every MCP message to the shared
 * daemon and hands the client's cwd and project path along, so project detection still works per client.
 *
 * When the daemon session is lost (daemon restarted, updated or crashed, session reaped) the bridge rebuilds it
 * on its own: it makes sure a daemon runs, repeats the client's `initialize` handshake on a fresh session, answers
 * the requests that were in flight with a retryable error, replays the request that found the session gone and
 * tells the client the tool list may have changed. The client never sees a closed connection.
 *
 * Returns false (nothing consumed from stdin) when the daemon is unavailable, so the caller can fall back.
 */
export async function runBridge(): Promise<boolean> {
  if (!(await ensureDaemon()))
    return false;

  const stdio = new StdioServerTransport();
  let remote!: StreamableHTTPClientTransport;

  let initializeRequest: (JSONRPCMessage & { id: RequestId }) | undefined;
  let initializedNotification: JSONRPCMessage | undefined;
  const pending = new Set<RequestId>();
  /** Requests this bridge is sending right now, they are replayed by their own forward call, not answered with an error. */
  const forwarding = new Set<RequestId>();
  const reinitWaiters = new Map<RequestId, () => void>();
  const recoveries: number[] = [];
  let recovering: Promise<void> | null = null;
  let reinitCounter = 0;
  let sseFailures = 0;
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown)
      return;

    shuttingDown = true;
    try {
      await Promise.race([remote.terminateSession(), new Promise((resolve) => setTimeout(resolve, 2000))]);
    } catch {
      // the daemon may already be gone
    }

    process.exit(0);
  };

  const replyError = (id: RequestId, text: string) =>
    stdio.send({ jsonrpc: '2.0', id, error: { code: -32000, message: text } });

  const onRemoteMessage = (message: JSONRPCMessage) => {
    sseFailures = 0;

    if ('id' in message && !('method' in message)) {
      const id = message.id as RequestId;
      const waiter = reinitWaiters.get(id);
      if (waiter) {
        reinitWaiters.delete(id);
        waiter();
        return;
      }

      pending.delete(id);
    }

    void stdio.send(message);
  };

  const recoverOrExit = () => {
    recover().catch((error: Error) => {
      console.error(`[common-mcp bridge] could not recover the daemon session (${error.message}), exiting so the client can restart the gateway`);
      void shutdown();
    });
  };

  const onRemoteError = (transport: StreamableHTTPClientTransport, error: Error & { code?: number }) => {
    console.error(`[common-mcp bridge] ${error.message}`);
    if (transport !== remote || shuttingDown)
      return;

    // 404 on the event stream: the daemon does not know this session any more, an idle bridge learns it here.
    // Repeated reconnect failures: the daemon is gone, start it again instead of waiting for the next request.
    if (error.code === 404 || (/Failed to reconnect SSE stream/.test(error.message) && ++sseFailures >= 3))
      recoverOrExit();
  };

  const createRemote = (): StreamableHTTPClientTransport => {
    const transport = new StreamableHTTPClientTransport(new URL(`${DAEMON_URL}/mcp`), {
      // Keep re-opening the event stream for as long as the bridge lives: a session without an open connection is reaped.
      reconnectionOptions: {
        initialReconnectionDelay: 1000,
        maxReconnectionDelay: 15000,
        reconnectionDelayGrowFactor: 1.5,
        maxRetries: Number.MAX_SAFE_INTEGER
      },
      requestInit: {
        headers: {
          Authorization: `Bearer ${ensureToken()}`,
          'x-gate-cwd': encodeURIComponent(process.cwd()),
          'x-gate-project-path': encodeURIComponent(process.env.COMMON_MCP_PROJECT_PATH ?? '')
        }
      }
    });
    transport.onmessage = onRemoteMessage;
    transport.onerror = (error: Error & { code?: number }) => onRemoteError(transport, error);
    // Only the ACTIVE transport ending ends the bridge, a replaced one closing is expected.
    transport.onclose = () => {
      if (transport === remote)
        void shutdown();
    };
    return transport;
  };

  function recover(): Promise<void> {
    if (recovering)
      return recovering;

    recovering = (async () => {
      const now = Date.now();
      while (recoveries.length > 0 && now - recoveries[0] > RECOVERY_WINDOW_MS)
        recoveries.shift();
      if (recoveries.length >= RECOVERY_LIMIT)
        throw new Error(`more than ${RECOVERY_LIMIT} recoveries in a minute`);
      recoveries.push(now);

      console.error('[common-mcp bridge] daemon session lost, recovering');

      // Requests that were already sent died with the old session, the client may retry them.
      for (const id of Array.from(pending)) {
        if (forwarding.has(id))
          continue;

        void replyError(id, 'The gateway was restarted while this request was running, please retry it');
        pending.delete(id);
      }
      sseFailures = 0;

      if (!(await ensureDaemon()))
        throw new Error('the daemon does not start');

      const fresh = createRemote();
      await fresh.start();

      if (initializeRequest) {
        const reinitId = `bridge-reinit-${++reinitCounter}`;
        const answered = new Promise<void>((resolve, reject) => {
          reinitWaiters.set(reinitId, resolve);
          setTimeout(() => reject(new Error('the daemon did not answer the re-initialize request')), 15000).unref();
        });
        await fresh.send({ ...initializeRequest, id: reinitId } as JSONRPCMessage);
        await answered;
        if (initializedNotification)
          await fresh.send(initializedNotification);
      }

      const old = remote;
      remote = fresh;
      void old.close().catch(() => undefined);

      console.error('[common-mcp bridge] daemon session recovered');
      void stdio.send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
    })().finally(() => {
      recovering = null;
    });

    return recovering;
  }

  /**
   * The client (re)starts its handshake. The existing daemon session is either already initialized (the daemon would
   * answer -32600) or gone (-32001), so the handshake always goes to a brand new session, and the daemon's own
   * answer travels back to the client with the original request id.
   */
  async function startFreshSession(request: JSONRPCMessage & { id: RequestId }): Promise<void> {
    if (!(await ensureDaemon()))
      throw new Error('the daemon does not start');

    const fresh = createRemote();
    await fresh.start();

    const old = remote;
    remote = fresh;
    sseFailures = 0;

    // Requests of the old session died with it, only this initialize is in flight on the new one.
    for (const pendingId of Array.from(pending)) {
      if (pendingId === request.id || forwarding.has(pendingId))
        continue;

      void replyError(pendingId, 'The gateway session was restarted while this request was running, please retry it');
      pending.delete(pendingId);
    }

    void old.terminateSession().catch(() => undefined).finally(() => void old.close().catch(() => undefined));
    await fresh.send(request);
  }

  const forward = async (message: JSONRPCMessage): Promise<void> => {
    const isRequest = 'id' in message && 'method' in message;
    const id = (message as { id?: RequestId }).id as RequestId;
    const isInitialize = isRequest && (message as { method?: string }).method === 'initialize';

    if ('method' in message) {
      if (isInitialize)
        initializeRequest = message as JSONRPCMessage & { id: RequestId };
      else if (message.method === 'notifications/initialized')
        initializedNotification = message;
    }

    if (isRequest) {
      pending.add(id);
      forwarding.add(id);
    }

    try {
      if (recovering)
        await recovering;

      if (isInitialize) {
        await startFreshSession(message as JSONRPCMessage & { id: RequestId });
        return;
      }

      try {
        await remote.send(message);
      } catch (error) {
        if (!isRecoverable(error as Error & { code?: number }))
          throw error;

        // This request never reached a live session, so it is safe to send it again on the recovered one.
        await recover();
        await remote.send(message);
      }
    } catch (error) {
      pending.delete(id);
      if (isRequest)
        void replyError(id, `Gateway daemon unreachable: ${(error as Error).message}`);
      else
        console.error(`[common-mcp bridge] could not forward a notification: ${(error as Error).message}`);
    } finally {
      forwarding.delete(id);
    }
  };

  remote = createRemote();
  stdio.onmessage = (message: JSONRPCMessage) => void forward(message);
  stdio.onclose = () => void shutdown();
  // The client ends the bridge by closing stdin; the SDK stdio transport does not report that as a close.
  process.stdin.on('end', () => void shutdown());
  process.stdin.on('close', () => void shutdown());

  await remote.start();
  await stdio.start();
  return true;
}
