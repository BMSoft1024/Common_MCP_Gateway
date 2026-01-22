import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { homedir } from 'os';
import { GatewayConfig, CommonMCPConfig } from '../types/config';

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
