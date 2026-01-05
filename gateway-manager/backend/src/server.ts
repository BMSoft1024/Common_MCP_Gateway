import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Server as SocketIOServer } from 'socket.io';
import { createServer } from 'http';
import chokidar from 'chokidar';
import fs from 'fs';
import path from 'path';
import { homedir } from 'os';
import { z } from 'zod';

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

const PORT = 1525;
const CONFIG_PATH = path.join(process.env.USERPROFILE || process.env.HOME || '', '.common-mcp', 'config.json');

const MCPServerSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  disabled: z.boolean().optional(),
  disabledTools: z.array(z.string()).optional(),
  timeout: z.number().min(1000).max(300000).optional(),
  retries: z.number().min(0).max(10).optional(),
  circuitBreakerThreshold: z.number().min(1).max(100).optional(),
  fallbackServers: z.array(z.string()).optional()
});

const MCPConfigSchema = z.object({
  'common-mcp': z.object({
    version: z.string().optional(),
    globalDefaults: z.object({
      timeout: z.number().optional(),
      retryAttempts: z.number().optional(),
      retryDelay: z.number().optional(),
      circuitBreaker: z.object({
        enabled: z.boolean().optional(),
        failureThreshold: z.number().optional(),
        resetTimeout: z.number().optional()
      }).optional()
    }).optional(),
    downstreamServers: z.record(MCPServerSchema),
    logging: z.object({
      level: z.string().optional(),
      format: z.string().optional(),
      file: z.string().optional(),
      maxSize: z.string().optional(),
      maxFiles: z.number().optional()
    }).optional()
  })
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'ws://localhost:1525', 'http://localhost:5173']
    }
  }
}));

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));

app.use(express.json());

let currentConfig: any = {};

function expandPath(configPath: string): string {
  const homeDir = homedir();
  return configPath
    .replace(/\$\{HOME\}/g, homeDir)
    .replace(/\$HOME/g, homeDir)
    .replace(/~\//g, homeDir + '/');
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      
      // Apply path expansion to logging file path
      if (parsed['common-mcp']?.logging?.file) {
        parsed['common-mcp'].logging.file = expandPath(parsed['common-mcp'].logging.file);
      }
      
      currentConfig = parsed;
      console.log('[CONFIG] Loaded Common MCP configuration from:', CONFIG_PATH);
      return currentConfig;
    } else {
      console.warn('[CONFIG] config.json not found at:', CONFIG_PATH);
      console.warn('[CONFIG] Creating default configuration...');
      const defaultConfig = {
        'common-mcp': {
          version: '1.0.0',
          globalDefaults: {
            timeout: 30000,
            retryAttempts: 3,
            retryDelay: 1000,
            circuitBreaker: {
              enabled: true,
              failureThreshold: 5,
              resetTimeout: 60000
            }
          },
          downstreamServers: {},
          logging: {
            level: 'INFO',
            format: 'json',
            file: path.join(homedir(), '.common-mcp', 'logs', 'common-mcp.log'),
            maxSize: '10MB',
            maxFiles: 5
          }
        }
      };
      fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2), 'utf-8');
      currentConfig = defaultConfig;
      return currentConfig;
    }
  } catch (error) {
    console.error('[CONFIG] Error loading configuration:', error);
    return currentConfig;
  }
}

function saveConfig(config: any) {
  try {
    const validated = MCPConfigSchema.parse(config);
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(validated, null, 2), 'utf-8');
    currentConfig = validated;
    io.emit('configUpdate', validated);
    console.log('[CONFIG] Configuration saved to:', CONFIG_PATH);
    return true;
  } catch (error) {
    console.error('[CONFIG] Error saving config:', error);
    throw error;
  }
}

const watcher = chokidar.watch(CONFIG_PATH, {
  persistent: true,
  ignoreInitial: true
});

watcher.on('change', () => {
  console.log('[WATCHER] Config file changed, reloading...');
  const newConfig = loadConfig();
  io.emit('configUpdate', newConfig);
});

app.get('/api/config', (req, res) => {
  try {
    const config = loadConfig();
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load configuration' });
  }
});

app.post('/api/config', (req, res) => {
  try {
    const newConfig = req.body;
    saveConfig(newConfig);
    res.json({ success: true, config: currentConfig });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Invalid configuration' });
  }
});

app.put('/api/config/server/:serverId', (req, res) => {
  try {
    const { serverId } = req.params;
    const serverConfig = req.body;
    
    const validated = MCPServerSchema.parse(serverConfig);
    
    if (!currentConfig['common-mcp']) {
      currentConfig['common-mcp'] = { downstreamServers: {} };
    }
    if (!currentConfig['common-mcp'].downstreamServers) {
      currentConfig['common-mcp'].downstreamServers = {};
    }
    
    currentConfig['common-mcp'].downstreamServers[serverId] = validated;
    saveConfig(currentConfig);
    
    res.json({ success: true, server: validated });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Invalid server configuration' });
  }
});

app.delete('/api/config/server/:serverId', (req, res) => {
  try {
    const { serverId } = req.params;
    
    if (currentConfig['common-mcp']?.downstreamServers?.[serverId]) {
      delete currentConfig['common-mcp'].downstreamServers[serverId];
      saveConfig(currentConfig);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Server not found' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete server' });
  }
});

app.patch('/api/config/server/:serverId/toggle', (req, res) => {
  try {
    const { serverId } = req.params;
    
    if (currentConfig['common-mcp']?.downstreamServers?.[serverId]) {
      const server = currentConfig['common-mcp'].downstreamServers[serverId];
      server.disabled = !server.disabled;
      saveConfig(currentConfig);
      res.json({ success: true, disabled: server.disabled });
    } else {
      res.status(404).json({ error: 'Server not found' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to toggle server' });
  }
});

app.get('/api/config/validate', (req, res) => {
  try {
    const validated = MCPConfigSchema.parse(currentConfig);
    res.json({ valid: true, config: validated });
  } catch (error: any) {
    res.status(400).json({ valid: false, errors: error.errors });
  }
});

io.on('connection', (socket) => {
  console.log('[SOCKET] Client connected:', socket.id);
  
  socket.emit('configUpdate', currentConfig);
  
  socket.on('disconnect', () => {
    console.log('[SOCKET] Client disconnected:', socket.id);
  });
});

loadConfig();

httpServer.listen(PORT, '127.0.0.1', () => {
  console.log(`[SERVER] MCP Marketplace UI running on http://127.0.0.1:${PORT}`);
  console.log(`[CONFIG] Watching: ${CONFIG_PATH}`);
  console.log(`[SOCKET] WebSocket ready for live updates`);
});
