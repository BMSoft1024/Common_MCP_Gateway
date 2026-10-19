export interface MCPServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  disabled?: boolean;
  disabledTools?: string[];
  timeout?: number;
  retryAttempts?: number;
  retries?: number;
  circuitBreakerThreshold?: number;
  fallbackServers?: string[];
  [key: string]: unknown;
}

export interface ServerPolicy {
  enabled?: boolean | null;
  tools?: Record<string, boolean>;
}

export interface GateConfig {
  knownProjects?: Record<string, string>;
  unknownProjectDefaults?: {
    defaultAllow?: boolean;
    servers?: Record<string, ServerPolicy>;
    alwaysVisibleTools?: string[];
  };
}

export interface MCPConfig {
  'common-mcp': {
    version?: string;
    globalDefaults?: Record<string, unknown>;
    downstreamServers: Record<string, MCPServer>;
    gate?: GateConfig;
    logging?: Record<string, unknown>;
  };
}

export interface CatalogTool {
  serverId: string;
  name: string;
  prefixedName: string;
  description: string;
  enabledByPolicy: boolean;
}

export interface ToolCatalog {
  generatedAt: string;
  servers: { serverId: string; command: string; args: string[]; disabledByConfig: boolean }[];
  tools: CatalogTool[];
}

export interface ToolCatalogResponse {
  exists: boolean;
  path: string;
  catalog: ToolCatalog | null;
}

export interface StatusInfo {
  configPath: string;
  configExists: boolean;
  toolCatalogPath: string;
  toolCatalogExists: boolean;
  toolCatalogGeneratedAt: string | null;
}
