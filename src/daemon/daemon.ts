#!/usr/bin/env node

import '../utils/hide-windows';
import * as http from 'http';
import { randomUUID, timingSafeEqual } from 'crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { loadConfig } from '../utils/config';
import { initLogger, getLogger } from '../utils/logger';
import { CommonMCPGateway } from '../gateway/server';
import { ConnectionPool } from '../gateway/connection-pool';
import { DAEMON_HOST, DAEMON_PORT, GATEWAY_VERSION, ensureToken, isNewerVersion } from './common';

/**
 * Shared background gateway. Every client's stdio bridge connects here over local HTTP, gets its own
 * gateway session (own project context and policy), and all sessions share ONE ConnectionPool, so each
 * downstream server runs once no matter how many clients are open.
 */
interface Session {
  transport: StreamableHTTPServerTransport;
  gateway: CommonMCPGateway;
  lastSeen: number;
  /** Requests and event streams currently open on this session. A live bridge always holds one SSE stream. */
  open: number;
}

const IDLE_EXIT_MS = Number(process.env.COMMON_MCP_DAEMON_IDLE_MS) || 15 * 60 * 1000;
/**
 * A session with no open connection for this long belongs to a bridge that died without saying goodbye
 * (killed process, crashed client). It is closed so it does not keep the daemon and its servers alive forever.
 */
const SESSION_TTL_MS = Number(process.env.COMMON_MCP_SESSION_TTL_MS) || 3 * 60 * 1000;

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req)
    chunks.push(chunk as Buffer);

  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : undefined;
}

function header(req: http.IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw)
    return undefined;

  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

async function main() {
  const config = loadConfig();
  initLogger(config.logging);
  const logger = getLogger();
  const token = ensureToken();
  const expectedAuth = Buffer.from(`Bearer ${token}`);
  const isAuthorized = (req: http.IncomingMessage): boolean => {
    const given = Buffer.from(req.headers.authorization ?? '');
    return given.length === expectedAuth.length && timingSafeEqual(given, expectedAuth);
  };
  const pool = new ConnectionPool();
  const sessions = new Map<string, Session>();
  let lastActivity = Date.now();

  const server = http.createServer(async (req, res) => {
    lastActivity = Date.now();

    try {
      if (req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        // Anyone on this machine may ask whether the daemon is alive, details are for token holders only.
        res.end(JSON.stringify(isAuthorized(req)
          ? { ok: true, version: GATEWAY_VERSION, sessions: sessions.size, downstream: pool.getActiveConnectionCount() }
          : { ok: true }));
        return;
      }

      if (!isAuthorized(req)) {
        res.writeHead(401).end('unauthorized');
        return;
      }

      if (req.method === 'POST' && req.url?.startsWith('/shutdown')) {
        const query = new URL(req.url, 'http://local').searchParams;
        const reply = (status: number, body: object) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(body));
        };

        const force = query.get('force') === '1';
        const forVersion = query.get('forVersion') ?? '';

        if (!isNewerVersion(forVersion, GATEWAY_VERSION)) {
          // Equal or older bridges never replace this daemon, not even forced ones: two bridges of the same new
          // version must not stop each other's fresh daemon.
          reply(409, { reason: 'current' });
        } else if (sessions.size > 0 && !force) {
          reply(409, { reason: 'busy', sessions: sessions.size });
        } else {
          logger.info({ message: 'Shutdown requested by a newer bridge', forVersion: query.get('forVersion'), sessions: sessions.size });
          reply(200, { stopping: true });
          setTimeout(() => process.exit(0), 100);
        }
        return;
      }

      if (!req.url?.startsWith('/mcp')) {
        res.writeHead(404).end();
        return;
      }

      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      const existing = sessionId ? sessions.get(sessionId) : undefined;

      if (existing) {
        existing.lastSeen = Date.now();
        existing.open++;
        res.on('close', () => {
          existing.open--;
          existing.lastSeen = Date.now();
        });
      }

      if (req.method === 'POST') {
        const body = await readJsonBody(req);

        // A client that initializes again on a live session has restarted its handshake: the old session is dropped
        // and a new one is opened, instead of answering "Server already initialized" forever.
        const reinitialize = existing !== undefined && isInitializeRequest(body);
        if (reinitialize) {
          logger.info({ message: 'Initialize on an existing session, replacing it', sessionId });
          void existing.transport.close().catch(() => undefined);
        } else if (existing) {
          await existing.transport.handleRequest(req, res, body);
          return;
        }

        if ((!sessionId || reinitialize) && isInitializeRequest(body)) {
          const gateway = new CommonMCPGateway(loadConfig(), undefined, {
            pool,
            cwd: header(req, 'x-gate-cwd'),
            projectPath: header(req, 'x-gate-project-path')
          });
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => {
              sessions.set(id, { transport, gateway, lastSeen: Date.now(), open: 0 });
              logger.info({ message: 'Session opened', sessionId: id, sessions: sessions.size });
            }
          });
          let closed = false;
          transport.onclose = () => {
            if (closed)
              return;

            closed = true;
            if (transport.sessionId && sessions.delete(transport.sessionId))
              logger.info({ message: 'Session closed', sessionId: transport.sessionId, sessions: sessions.size });

            void gateway.stop().catch(() => undefined);
          };

          await gateway.start(transport);
          await transport.handleRequest(req, res, body);
          return;
        }

        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Unknown or missing session' }, id: null }));
        return;
      }

      if ((req.method === 'GET' || req.method === 'DELETE') && existing) {
        await existing.transport.handleRequest(req, res);
        return;
      }

      if (req.method === 'GET' || req.method === 'DELETE') {
        // MCP: an unknown session id is 404, which tells the bridge that its session is gone.
        res.writeHead(404).end();
        return;
      }

      res.writeHead(400).end('bad request');
    } catch (error) {
      logger.error({ message: 'Daemon request failed', error: (error as Error).message });
      if (!res.headersSent)
        res.writeHead(500).end('internal error');
    }
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    // Another bridge won the race to start the daemon: that one serves, this one leaves quietly.
    if (error.code === 'EADDRINUSE')
      process.exit(0);

    logger.error({ message: 'Daemon server error', error: error.message });
    process.exit(1);
  });

  server.listen(DAEMON_PORT, DAEMON_HOST, () => logger.info({ message: 'Common MCP daemon listening', port: DAEMON_PORT }));

  setInterval(() => {
    if (sessions.size === 0 && Date.now() - lastActivity > IDLE_EXIT_MS) {
      logger.info('No sessions for a while, daemon exits');
      process.exit(0);
    }
  }, 60 * 1000).unref();

  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (session.open === 0 && now - session.lastSeen > SESSION_TTL_MS) {
        logger.info({ message: 'Closing abandoned session', sessionId: id, idleMs: now - session.lastSeen });
        void session.transport.close().catch(() => undefined);
      }
    }
  }, Math.min(30 * 1000, Math.max(250, SESSION_TTL_MS / 2))).unref();

  process.on('exit', () => pool.killAllSync());
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));

  // One broken session must not take every other client down with the daemon.
  process.on('uncaughtException', (error) => logger.error({ message: 'Uncaught exception in daemon', error: error.message, stack: error.stack }));
  process.on('unhandledRejection', (reason) => logger.error({ message: 'Unhandled rejection in daemon', reason: String(reason) }));
}

main().catch((error) => {
  console.error('Fatal error starting daemon:', error);
  process.exit(1);
});
