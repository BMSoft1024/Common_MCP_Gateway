import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Server as SocketIOServer } from 'socket.io';
import { createServer } from 'http';
import chokidar from 'chokidar';
import fs from 'fs';
import { timingSafeEqual } from 'crypto';
import { z } from 'zod';
import {
  CONFIG_PATH,
  TOOL_CATALOG_PATH,
  ConfigError,
  MCPServerSchema,
  formatZodError,
  normalizeServer,
  readConfigFromDisk,
  updateConfig
} from './config-store';

const PORT = Number(process.env.PORT) || 1525;
const HOST = process.env.GATEWAY_MANAGER_HOST || '127.0.0.1';
const API_SECRET = process.env.GATEWAY_MANAGER_SECRET || 'change-me-in-production';
const LOCALHOST_ONLY = process.env.GATEWAY_MANAGER_ALLOW_REMOTE !== 'true';
const UI_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: UI_ORIGINS, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
  // Express middleware does not see /socket.io requests, and browsers do not apply CORS to WebSocket handshakes,
  // so any web page could read the configuration (including env secrets) over the socket without this check.
  allowRequest: (req, callback) => {
    const problem = localRequestProblem(req.socket.remoteAddress, req.headers.host, req.headers.origin);
    if (problem)
      console.warn(`[SOCKET] Rejected connection: ${problem}`);

    callback(null, problem === null);
  }
});

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", `ws://localhost:${PORT}`, ...UI_ORIGINS]
      }
    }
  })
);
app.use(cors({ origin: UI_ORIGINS, credentials: true }));
app.use(express.json());

const LOCAL_HOST_PATTERN = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/** Why a request must be refused in localhost-only mode, or null when it may pass. Shared by the REST API and the socket. */
function localRequestProblem(remoteAddress: string | undefined, host: string | undefined, origin: string | undefined): string | null {
  if (!LOCALHOST_ONLY)
    return null;

  const clientIp = remoteAddress || '';
  if (clientIp !== '127.0.0.1' && clientIp !== '::1' && clientIp !== '::ffff:127.0.0.1')
    return 'localhost only';

  // Blocks DNS rebinding (foreign Host) and cross-site requests from other web pages (foreign Origin).
  if (!LOCAL_HOST_PATTERN.test(host || ''))
    return 'unexpected Host header';

  if (origin && !UI_ORIGINS.includes(origin))
    return 'unexpected Origin';

  return null;
}

function localhostOnlyMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const problem = localRequestProblem(req.ip || req.socket.remoteAddress, req.headers.host, req.headers.origin);
  if (problem) {
    res.status(403).json({ error: `Access denied: ${problem}` });
    return;
  }

  next();
}

function apiAuthMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (API_SECRET === 'change-me-in-production') {
    next();
    return;
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Bearer token' });
    return;
  }
  const given = Buffer.from(authHeader.slice(7));
  const expected = Buffer.from(API_SECRET);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }
  next();
}

app.use(localhostOnlyMiddleware);
app.use('/api', apiAuthMiddleware);

const SERVER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const RESERVED_IDS = new Set(['__proto__', 'constructor', 'prototype']);

function assertValidServerId(serverId: string): void {
  if (!SERVER_ID_PATTERN.test(serverId) || RESERVED_IDS.has(serverId)) {
    throw new ConfigError('Invalid server name: use letters, digits, "-" and "_" (max 64 characters)', 400);
  }
}

function sendError(res: express.Response, error: unknown, fallbackStatus = 500): void {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: formatZodError(error) });
  } else if (error instanceof ConfigError) {
    res.status(error.status).json({ error: error.message });
  } else {
    res.status(fallbackStatus).json({ error: (error as Error).message || 'Unexpected error' });
  }
}

function readToolCatalog(): { exists: boolean; catalog: unknown } {
  try {
    return { exists: true, catalog: JSON.parse(fs.readFileSync(TOOL_CATALOG_PATH, 'utf-8')) };
  } catch {
    return { exists: false, catalog: null };
  }
}

function broadcastConfig(): void {
  try {
    io.emit('configUpdate', readConfigFromDisk());
  } catch (error) {
    io.emit('configError', (error as Error).message);
  }
}

app.get('/api/status', (_req, res) => {
  const { exists, catalog } = readToolCatalog();
  res.json({
    configPath: CONFIG_PATH,
    configExists: fs.existsSync(CONFIG_PATH),
    toolCatalogPath: TOOL_CATALOG_PATH,
    toolCatalogExists: exists,
    toolCatalogGeneratedAt: (catalog as { generatedAt?: string } | null)?.generatedAt ?? null
  });
});

app.get('/api/config', (_req, res) => {
  try {
    res.json(readConfigFromDisk());
  } catch (error) {
    sendError(res, error);
  }
});

app.put('/api/config/server/:serverId', (req, res) => {
  try {
    const { serverId } = req.params;
    assertValidServerId(serverId);
    const server = normalizeServer(MCPServerSchema.parse(req.body));
    updateConfig((config) => {
      config['common-mcp'].downstreamServers[serverId] = server;
    });
    res.json({ success: true, server });
    broadcastConfig();
  } catch (error) {
    sendError(res, error, 400);
  }
});

app.delete('/api/config/server/:serverId', (req, res) => {
  try {
    const { serverId } = req.params;
    assertValidServerId(serverId);
    let found = true;
    updateConfig((config) => {
      const servers = config['common-mcp'].downstreamServers;
      if (servers[serverId]) {
        delete servers[serverId];
      } else {
        found = false;
      }
    });
    if (!found) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }
    res.json({ success: true });
    broadcastConfig();
  } catch (error) {
    sendError(res, error);
  }
});

app.patch('/api/config/server/:serverId/toggle', (req, res) => {
  try {
    const { serverId } = req.params;
    assertValidServerId(serverId);
    let disabled: boolean | undefined;
    updateConfig((config) => {
      const server = config['common-mcp'].downstreamServers[serverId];
      if (server) {
        server.disabled = !server.disabled;
        disabled = server.disabled;
      }
    });
    if (disabled === undefined) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }
    res.json({ success: true, disabled });
    broadcastConfig();
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/config/validate', (_req, res) => {
  try {
    res.json({ valid: true, config: readConfigFromDisk() });
  } catch (error) {
    res.status(400).json({ valid: false, error: (error as Error).message });
  }
});

app.get('/api/tool-catalog', (_req, res) => {
  const { exists, catalog } = readToolCatalog();
  res.json({ exists, path: TOOL_CATALOG_PATH, catalog });
});

io.on('connection', (socket) => {
  console.log('[SOCKET] Client connected:', socket.id);
  try {
    socket.emit('configUpdate', readConfigFromDisk());
  } catch (error) {
    socket.emit('configError', (error as Error).message);
  }
  socket.on('disconnect', () => console.log('[SOCKET] Client disconnected:', socket.id));
});

// chokidar handles atomic replace (temp+rename) writes; the catalog may not exist yet, so react to 'add' too.
function watchFile(filePath: string, onChange: () => void): void {
  chokidar
    .watch(filePath, { persistent: true, ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 150 } })
    .on('add', onChange)
    .on('change', onChange);
}

watchFile(CONFIG_PATH, () => {
  console.log('[WATCHER] Config file changed, broadcasting');
  broadcastConfig();
});

watchFile(TOOL_CATALOG_PATH, () => {
  console.log('[WATCHER] Tool catalog changed, broadcasting');
  io.emit('catalogUpdate', readToolCatalog());
});

try {
  readConfigFromDisk();
  console.log('[CONFIG] Loaded Common MCP configuration from:', CONFIG_PATH);
} catch (error) {
  console.error('[CONFIG] Initial load failed:', (error as Error).message);
}

if (!LOCALHOST_ONLY && API_SECRET === 'change-me-in-production') {
  // The API can add a downstream server with an arbitrary command, so it must never be open to the network.
  console.error('[SERVER] GATEWAY_MANAGER_ALLOW_REMOTE=true requires GATEWAY_MANAGER_SECRET, refusing to start');
  process.exit(1);
}

httpServer.listen(PORT, HOST, () => {
  console.log(`[SERVER] Common MCP Gateway Manager API running on http://${HOST}:${PORT}`);
  console.log(`[CONFIG] Watching: ${CONFIG_PATH}`);
  console.log(`[CATALOG] Watching: ${TOOL_CATALOG_PATH}`);
  console.log('[SOCKET] WebSocket ready for live updates');
});
