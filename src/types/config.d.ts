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
  retries?: number;
  env?: Record<string, string>;
  healthCheck?: HealthCheckConfig;
  disabled?: boolean;
  fallbackServers?: string[];
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

export interface CommonMCPConfig {
  version: string;
  globalDefaults: GlobalDefaults;
  downstreamServers: Record<string, DownstreamServerConfig>;
  logging: LoggingConfig;
}

export interface GatewayConfig {
  'common-mcp': CommonMCPConfig;
}
