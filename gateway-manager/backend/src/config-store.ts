import fs from 'fs';
import path from 'path';
import { homedir } from 'os';
import { z } from 'zod';

export const CONFIG_PATH =
  process.env.COMMON_MCP_CONFIG || path.join(homedir(), '.common-mcp', 'config.json');

export const TOOL_CATALOG_PATH =
  process.env.COMMON_MCP_TOOL_CATALOG || path.join(homedir(), '.common-mcp', 'tool-catalog.json');

// passthrough() everywhere: the config file is shared with the gateway and other tools
// (gate section, health checks, future fields). Unknown keys must survive a save from this UI.
export const MCPServerSchema = z
  .object({
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    disabled: z.boolean().optional(),
    disabledTools: z.array(z.string()).optional(),
    timeout: z.number().min(1000).max(300000).optional(),
    retries: z.number().min(0).max(10).optional(),
    retryAttempts: z.number().min(0).max(10).optional(),
    circuitBreakerThreshold: z.number().min(1).max(100).optional(),
    fallbackServers: z.array(z.string()).optional()
  })
  .passthrough();

const CommonMcpSchema = z
  .object({
    version: z.string().optional(),
    globalDefaults: z.object({}).passthrough().optional(),
    downstreamServers: z.record(MCPServerSchema),
    gate: z.object({}).passthrough().optional(),
    logging: z.object({}).passthrough().optional()
  })
  .passthrough();

export const MCPConfigSchema = z.object({ 'common-mcp': CommonMcpSchema }).passthrough();

export type MCPServer = z.infer<typeof MCPServerSchema>;
export type MCPConfig = z.infer<typeof MCPConfigSchema>;

export class ConfigError extends Error {
  constructor(message: string, public readonly status: number = 400) {
    super(message);
  }
}

export function formatZodError(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

// The gateway reads retryAttempts. Older UI versions wrote "retries"; keep one canonical field.
export function normalizeServer(server: MCPServer): MCPServer {
  const { retries, ...rest } = server;
  if (rest.retryAttempts === undefined && retries !== undefined) {
    return { ...rest, retryAttempts: retries };
  }
  return rest;
}

export function defaultConfig(): MCPConfig {
  return {
    'common-mcp': {
      version: '1.0.0',
      globalDefaults: {
        timeout: 30000,
        retryAttempts: 3,
        retryDelay: 1000,
        circuitBreaker: { enabled: true, failureThreshold: 5, resetTimeout: 60000 }
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
}

export function readConfigFromDisk(): MCPConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    const created = defaultConfig();
    writeConfigToDisk(created);
    return created;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (error) {
    throw new ConfigError(`Config file is not valid JSON (${CONFIG_PATH}): ${(error as Error).message}`, 500);
  }
  const result = MCPConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigError(`Config file failed validation: ${formatZodError(result.error)}`, 500);
  }
  return result.data;
}

// Atomic replace (temp file + rename) so the gateway's file watcher never sees a half-written
// file, plus a rolling backup of the previous content.
export function writeConfigToDisk(config: MCPConfig): void {
  const validated = MCPConfigSchema.parse(config);
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  if (fs.existsSync(CONFIG_PATH)) {
    fs.copyFileSync(CONFIG_PATH, `${CONFIG_PATH}.bak`);
  }
  const tmpPath = `${CONFIG_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(validated, null, 2), 'utf-8');
  fs.renameSync(tmpPath, CONFIG_PATH);
}

// Read-modify-write against the file on disk, never against a cached copy: other tools
// and the gateway update the same file, and a stale in-memory copy would overwrite their changes.
export function updateConfig(mutate: (config: MCPConfig) => void): MCPConfig {
  const config = readConfigFromDisk();
  mutate(config);
  writeConfigToDisk(config);
  return config;
}
