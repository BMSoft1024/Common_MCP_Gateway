import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { homedir } from 'os';
import { GatewayConfig, CommonMCPConfig, ProjectPolicy } from '../types/config';

function expandPath(path: string): string {
  const homeDir = homedir();
  return path
    .replace(/\$\{HOME\}/g, homeDir)
    .replace(/\$HOME/g, homeDir)
    .replace(/~\//g, homeDir + '/');
}

export function loadConfig(configPath?: string): CommonMCPConfig {
  const path = configPath || process.env.COMMON_MCP_CONFIG || resolve(homedir(), '.common-mcp', 'config.json');
  
  try {
    const content = readFileSync(path, 'utf-8');
    const config: GatewayConfig = JSON.parse(content);
    
    if (!config['common-mcp']) {
      throw new Error('Invalid config: missing "common-mcp" section');
    }
    
    return validateAndExpandConfig(config['common-mcp']);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      const defaultConfig = getDefaultConfig();
      createDefaultConfigFile(path, defaultConfig);
      return defaultConfig;
    }
    throw error;
  }
}

function createDefaultConfigFile(configPath: string, config: CommonMCPConfig): void {
  try {
    const configDir = dirname(configPath);
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
    
    const logsDir = resolve(configDir, 'logs');
    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, { recursive: true });
    }
    
    const fullConfig: GatewayConfig = { 'common-mcp': config };
    writeFileSync(configPath, JSON.stringify(fullConfig, null, 2), 'utf-8');
    console.error(`[common-mcp] Created default config at: ${configPath}`);
  } catch (err) {
    console.error(`[common-mcp] Warning: Could not create default config file: ${(err as Error).message}`);
  }
}

function validateAndExpandConfig(config: CommonMCPConfig): CommonMCPConfig {
  if (!config.version) {
    throw new Error('Config validation error: missing version');
  }
  
  if (!config.globalDefaults) {
    throw new Error('Config validation error: missing globalDefaults');
  }
  
  if (!config.downstreamServers || Object.keys(config.downstreamServers).length === 0) {
    throw new Error('Config validation error: no downstream servers configured');
  }
  
  for (const [serverId, serverConfig] of Object.entries(config.downstreamServers)) {
    if (!serverConfig.command) {
      throw new Error(`Config validation error: server "${serverId}" missing command`);
    }
    if (!Array.isArray(serverConfig.args)) {
      throw new Error(`Config validation error: server "${serverId}" args must be array`);
    }
    if (serverConfig.retryAttempts === undefined && typeof serverConfig.retries === 'number') {
      serverConfig.retryAttempts = serverConfig.retries;
    }
  }
  
  if (config.logging?.file) {
    config.logging.file = expandPath(config.logging.file);
  }
  
  return config;
}

function getDefaultConfig(): CommonMCPConfig {
  return {
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
    downstreamServers: {
      'time': {
        command: 'python',
        args: ['-m', 'mcp_server_time'],
        timeout: 30000,
        retryAttempts: 3,
        env: {}
      },
      'fetch': {
        command: 'uvx',
        args: ['mcp-server-fetch'],
        timeout: 30000,
        retryAttempts: 3,
        env: {}
      },
      'memory': {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory'],
        timeout: 30000,
        retryAttempts: 3,
        env: {}
      },
      'filesystem': {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
        timeout: 30000,
        retryAttempts: 3,
        env: {}
      },
      'sequential-thinking': {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
        timeout: 60000,
        retryAttempts: 2,
        env: {}
      }
    },
    logging: {
      level: 'INFO',
      format: 'json',
      file: resolve(homedir(), '.common-mcp', 'logs', 'common-mcp.log'),
      maxSize: '10MB',
      maxFiles: 5
    }
  };
}

// ---------------------------------------------------------------------------
// Per-project gate policy resolution
// ---------------------------------------------------------------------------

export interface ProjectContext {
  matched: 'project' | 'unknown';
  projectId?: string;
  projectPath?: string;
  policyPath?: string;
  policy: ProjectPolicy;
}

export function normalizeFsPath(p: string): string {
  return resolve(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function findKnownProject(
  knownProjects: Record<string, string> | undefined,
  candidatePath: string
): { id: string; path: string } | null {
  if (!knownProjects) return null;
  const candidate = normalizeFsPath(candidatePath);
  let best: { id: string; path: string } | null = null;
  let bestLen = -1;
  for (const [id, projectPath] of Object.entries(knownProjects)) {
    const normalized = normalizeFsPath(projectPath);
    if (candidate === normalized || candidate.startsWith(normalized + '/')) {
      if (normalized.length > bestLen) {
        best = { id, path: projectPath };
        bestLen = normalized.length;
      }
    }
  }
  return best;
}

export function getPolicyFilePath(projectPath: string): string {
  return join(projectPath, '.ai', 'mcp_gate_policy.json');
}

export function loadProjectPolicy(policyPath: string, expectedProjectId?: string): ProjectPolicy {
  try {
    const raw = JSON.parse(readFileSync(policyPath, 'utf-8'));
    if (expectedProjectId && raw.projectId && raw.projectId !== expectedProjectId) {
      console.error(`[common-mcp] Policy projectId mismatch in ${policyPath} (expected ${expectedProjectId}, got ${raw.projectId}), ignoring file`);
      return { version: 1, defaultAllow: true, servers: {} };
    }
    return {
      version: typeof raw.version === 'number' ? raw.version : 1,
      projectId: raw.projectId,
      defaultAllow: raw.defaultAllow !== false,
      servers: raw.servers && typeof raw.servers === 'object' ? raw.servers : {}
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`[common-mcp] Warning: failed to read policy ${policyPath}: ${(error as Error).message}`);
    }
    return { version: 1, defaultAllow: true, servers: {} };
  }
}

export function getUnknownPolicy(config: CommonMCPConfig): ProjectPolicy {
  const unknown = config.gate?.unknownProjectDefaults;
  return {
    version: 1,
    defaultAllow: unknown?.defaultAllow !== false,
    servers: unknown?.servers ?? {}
  };
}

export function buildProjectContext(
  config: CommonMCPConfig,
  projectId: string,
  projectPath: string
): ProjectContext {
  const policyPath = getPolicyFilePath(projectPath);
  return {
    matched: 'project',
    projectId,
    projectPath,
    policyPath,
    policy: loadProjectPolicy(policyPath, projectId)
  };
}

export function resolveProjectContext(config: CommonMCPConfig, origin?: { cwd?: string; projectPath?: string }): ProjectContext {
  const knownProjects = config.gate?.knownProjects;

  // 1. Explicit env override (manual or per-project client configs)
  const envPath = origin?.projectPath || process.env.COMMON_MCP_PROJECT_PATH;
  if (envPath) {
    const found = findKnownProject(knownProjects, envPath);
    if (found) {
      return buildProjectContext(config, found.id, found.path);
    }
    console.error(`[common-mcp] COMMON_MCP_PROJECT_PATH "${envPath}" is not a registered project, falling back to cwd`);
  }

  // 2. cwd-based identification: the client spawns the gate with cwd = workspace
  const cwd = origin?.cwd || process.cwd();
  const found = findKnownProject(knownProjects, cwd);
  if (found) {
    return buildProjectContext(config, found.id, found.path);
  }

  // 3. Unknown project: global defaults apply
  return { matched: 'unknown', policy: getUnknownPolicy(config) };
}

/// `projectOnly` servers (config flag, user request 2026-09-21: "globálisan ne legyen
/// bekapcsolva, csak egy-egy adott projektnél") require an EXPLICIT `servers[id].enabled: true`
/// in the resolved policy — neither defaultAllow nor a bare policy entry enables them.
export function isServerAllowed(policy: ProjectPolicy, serverId: string, projectOnly = false): boolean {
  const serverPolicy = policy.servers?.[serverId];
  if (serverPolicy?.enabled !== undefined) return serverPolicy.enabled;
  if (projectOnly) return false;
  return policy.defaultAllow;
}

export function isToolAllowed(policy: ProjectPolicy, serverId: string, toolName: string, projectOnly = false): boolean {
  const serverPolicy = policy.servers?.[serverId];
  if (serverPolicy?.enabled !== undefined ? !serverPolicy.enabled : projectOnly) return false;
  if (!serverPolicy) return policy.defaultAllow;
  const toolValue = serverPolicy.tools?.[toolName];
  return toolValue !== undefined ? toolValue : policy.defaultAllow;
}
