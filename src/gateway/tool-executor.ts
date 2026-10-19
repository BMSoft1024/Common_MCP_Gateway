import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { getLogger } from '../utils/logger';
import { CommonMCPConfig, DownstreamServerConfig, ProjectPolicy } from '../types/config';
import { isServerAllowed, isToolAllowed } from '../utils/config';
import { TimeoutWatchdog } from '../middleware/timeout';
import { ConnectionPool } from './connection-pool';

export interface ToolExecutorDeps {
  pool: ConnectionPool;
  watchdog: TimeoutWatchdog;
  getConfig: () => CommonMCPConfig;
  getPolicy: () => ProjectPolicy;
}

/** Runs one tools/call against a downstream server: policy check, connect, circuit breaker, retry, timeout, fallback. */
export class ToolExecutor {
  private logger = getLogger();
  private attemptSeq = 0;

  constructor(private deps: ToolExecutorDeps) {}

  /** Calls the tool on its server and, when that fails, on each configured fallback server in turn. */
  async call(serverId: string, toolName: string, args: any, requestId: string, displayName = `${serverId}__${toolName}`): Promise<any> {
    const serverConfig = this.checkCallable(serverId, toolName, displayName);

    try {
      const result = await this.invoke(serverId, serverConfig, toolName, args, requestId);
      this.logger.info({ message: 'Tool call successful', requestId, serverId, toolName });
      return result;
    } catch (error) {
      this.logger.error({
        message: 'Tool call failed',
        requestId,
        serverId,
        toolName,
        error: (error as Error).message
      });

      const fallbackServers = this.deps.getConfig().downstreamServers[serverId]?.fallbackServers ?? [];
      if (fallbackServers.length > 0) {
        this.logger.warn({ message: 'Attempting fallback servers', requestId, serverId, fallbackServers });

        for (const fallbackServerId of fallbackServers) {
          try {
            const fallbackConfig = this.checkCallable(fallbackServerId, toolName, `${fallbackServerId}__${toolName}`);
            const fallbackResult = await this.invoke(fallbackServerId, fallbackConfig, toolName, args, requestId);
            this.logger.info({
              message: 'Fallback server successful',
              requestId,
              primaryServer: serverId,
              fallbackServer: fallbackServerId,
              toolName
            });
            return fallbackResult;
          } catch (fallbackError) {
            this.logger.warn({
              message: 'Fallback server failed',
              requestId,
              primaryServer: serverId,
              fallbackServer: fallbackServerId,
              toolName,
              error: (fallbackError as Error).message
            });
          }
        }
      }

      throw error;
    }
  }

  private checkCallable(serverId: string, toolName: string, displayName: string): DownstreamServerConfig {
    const serverConfig = this.deps.getConfig().downstreamServers[serverId];
    if (!serverConfig) {
      throw new Error(`Unknown downstream server: ${serverId}`);
    }

    if (serverConfig.disabled) {
      throw new Error(`Server "${serverId}" is disabled and cannot be called`);
    }

    const policy = this.deps.getPolicy();
    const projectOnly = serverConfig.projectOnly === true;
    if (!isServerAllowed(policy, serverId, projectOnly)) {
      throw new Error(`Server "${serverId}" is not allowed for this project`);
    }
    if (!isToolAllowed(policy, serverId, toolName, projectOnly)) {
      throw new Error(`Tool "${displayName}" is not allowed for this project`);
    }

    return serverConfig;
  }

  private async invoke(serverId: string, serverConfig: DownstreamServerConfig, toolName: string, args: any, requestId: string): Promise<any> {
    const { globalDefaults } = this.deps.getConfig();
    const circuitBreakerConfig = {
      ...globalDefaults.circuitBreaker,
      failureThreshold: serverConfig.circuitBreakerThreshold || globalDefaults.circuitBreaker.failureThreshold
    };
    const connection = await this.deps.pool.createConnection(serverId, serverConfig, circuitBreakerConfig);

    const timeout = serverConfig.timeout || globalDefaults.timeout;
    const retryAttempts = serverConfig.retryAttempts ?? globalDefaults.retryAttempts;

    return await connection.circuitBreaker.execute(async () =>
      connection.retryEngine.executeWithRetry(
        () =>
          new Promise<any>((resolve, reject) => {
            // One watchdog id per attempt: a late reply of a timed out attempt must not cancel the timer of its retry or fallback.
            const watchdogId = `${requestId}#${++this.attemptSeq}`;
            this.deps.watchdog.start(watchdogId, timeout, () => reject(new Error(`Request timed out after ${timeout}ms`)));

            connection.client
              .request({ method: 'tools/call', params: { name: toolName, arguments: args } } as any, CallToolResultSchema)
              .then((result: any) => {
                this.deps.watchdog.cancel(watchdogId);
                resolve(result);
              })
              .catch((error: any) => {
                this.deps.watchdog.cancel(watchdogId);
                reject(error);
              });
          }),
        { maxAttempts: retryAttempts, baseDelay: globalDefaults.retryDelay },
        { requestId, serverId, tool: toolName }
      )
    );
  }
}
