import { readFileSync } from 'fs';
import { resolve } from 'path';
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
      return getDefaultConfig();
    }
    throw error;
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
    downstreamServers: {},
    logging: {
      level: 'INFO',
      format: 'json',
      file: resolve(homedir(), '.common-mcp', 'logs', 'common-mcp.log'),
      maxSize: '10MB',
      maxFiles: 5
    }
  };
}
