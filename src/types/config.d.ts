export interface CircuitBreakerConfig {
  enabled: boolean;
  failureThreshold: number;
  resetTimeout: number;
}

export interface HealthCheckConfig {
  enabled: boolean;
  method: string;
  interval: number;
}

export interface DownstreamServerConfig {
  command: string;
  args: string[];
  timeout?: number;
  retryAttempts?: number;
  /** Legacy alias written by older Gateway Manager versions; mapped to retryAttempts on load. */
  retries?: number;
  env?: Record<string, string>;
  healthCheck?: HealthCheckConfig;
  disabled?: boolean;
  /** "Csak projektben" mode (2026-09-21): not enabled by default anywhere — a policy must
   *  explicitly set servers[id].enabled=true to expose it; defaultAllow can't. */
  projectOnly?: boolean;
  fallbackServers?: string[];
  circuitBreakerThreshold?: number;
}

export interface LoggingConfig {
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  format: 'json' | 'simple';
  file: string;
  maxSize: string;
  maxFiles: number;
}

export interface GlobalDefaults {
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
  circuitBreaker: CircuitBreakerConfig;
}

export interface ServerPolicy {
  enabled?: boolean;
  tools?: Record<string, boolean>;
}

export interface ProjectPolicy {
  version: number;
  projectId?: string;
  defaultAllow: boolean;
  servers: Record<string, ServerPolicy>;
}

export interface UnknownProjectDefaults {
  defaultAllow: boolean;
  servers?: Record<string, ServerPolicy>;
  alwaysVisibleTools?: string[];
}

export interface GateConfig {
  /**
   * When true, Claude Desktop (no usable working directory) only sees the meta tool `gate__set_project_context`
   * (plus `alwaysVisibleTools`) until the project root is declared. Default false: every client sees all tools.
   */
  requireContextDeclaration?: boolean;
  knownProjects?: Record<string, string>;
  unknownProjectDefaults?: UnknownProjectDefaults;
}

export interface CommonMCPConfig {
  version: string;
  globalDefaults: GlobalDefaults;
  downstreamServers: Record<string, DownstreamServerConfig>;
  logging: LoggingConfig;
  gate?: GateConfig;
}

export interface GatewayConfig {
  'common-mcp': CommonMCPConfig;
}
