import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  ListToolsRequestSchema,
  ListToolsResultSchema,
  Tool
} from '@modelcontextprotocol/sdk/types.js';
import { getLogger } from '../utils/logger';
import { CommonMCPConfig } from '../types/config';
import { ConnectionPool } from './connection-pool';
import { TimeoutWatchdog, generateRequestId } from '../middleware/timeout';

interface ToolMapping {
  serverId: string;
  toolName: string;
}

export class CommonMCPGateway {
  private server: Server;
  private connectionPool: ConnectionPool;
  private timeoutWatchdog: TimeoutWatchdog;
  private logger = getLogger();
  private config: CommonMCPConfig;
  private toolNameMap: Map<string, ToolMapping> = new Map();
  private cachedTools: Tool[] = [];

  constructor(config: CommonMCPConfig) {
    this.config = config;
    this.connectionPool = new ConnectionPool();
    this.timeoutWatchdog = new TimeoutWatchdog();
    this.toolNameMap = new Map();

    this.server = new Server(
      {
        name: 'common-mcp-gateway',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {
            listChanged: true
          }
        }
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      this.logger.info('Handling list_tools request');

      await this.refreshToolCache();
      return { tools: this.cachedTools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const requestId = generateRequestId();
      const { name, arguments: args } = request.params;

      this.logger.info({
        message: 'Handling call_tool request',
        requestId,
        toolName: name,
        arguments: args
      });

      const [serverId, toolName] = this.parseToolName(name);
      
      if (!serverId || !toolName) {
        throw new Error(`Invalid tool name format: ${name}. Expected: serverId__toolName (double underscore separator)`);
      }

      const serverConfig = this.config.downstreamServers[serverId];
      if (!serverConfig) {
        throw new Error(`Unknown downstream server: ${serverId}`);
      }

      if (serverConfig.disabled) {
        throw new Error(`Server "${serverId}" is disabled and cannot be called`);
      }

      try {
        const circuitBreakerConfig = {
          ...this.config.globalDefaults.circuitBreaker,
          failureThreshold: serverConfig.circuitBreakerThreshold || this.config.globalDefaults.circuitBreaker.failureThreshold
        };
        const connection = await this.connectionPool.createConnection(
          serverId,
          serverConfig,
          circuitBreakerConfig
        );

        const timeout = serverConfig.timeout || this.config.globalDefaults.timeout;
        const retryAttempts = serverConfig.retryAttempts || serverConfig.retries || this.config.globalDefaults.retryAttempts;

        const result = await connection.circuitBreaker.execute(async () => {
          return await connection.retryEngine.executeWithRetry(
            async () => {
              return await new Promise<any>((resolve, reject) => {
                this.timeoutWatchdog.start(requestId, timeout, () => {
                  reject(new Error(`Request timed out after ${timeout}ms`));
                });

                connection.client.request(
                  { 
                    method: 'tools/call',
                    params: {
                      name: toolName,
                      arguments: args
                    }
                  } as any,
                  CallToolResultSchema
                )
                .then((result: any) => {
                  this.timeoutWatchdog.cancel(requestId);
                  resolve(result);
                })
                .catch((error: any) => {
                  this.timeoutWatchdog.cancel(requestId);
                  reject(error);
                });
              });
            },
            {
              maxAttempts: retryAttempts,
              baseDelay: this.config.globalDefaults.retryDelay
            },
            {
              requestId,
              serverId,
              tool: toolName
            }
          );
        });

        this.logger.info({
          message: 'Tool call successful',
          requestId,
          serverId,
          toolName
        });

        return result as any;
      } catch (error) {
        this.logger.error({
          message: 'Tool call failed',
          requestId,
          serverId,
          toolName,
          error: (error as Error).message
        });

        // Try fallback servers if configured
        const serverConfig = this.config.downstreamServers[serverId];
        if (serverConfig.fallbackServers && serverConfig.fallbackServers.length > 0) {
          this.logger.warn({
            message: 'Attempting fallback servers',
            requestId,
            serverId,
            fallbackServers: serverConfig.fallbackServers
          });

          for (const fallbackServerId of serverConfig.fallbackServers) {
            try {
              const fallbackResult = await this.executeToolCall(
                fallbackServerId,
                toolName,
                args,
                requestId
              );
              
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
    });
  }

  private async executeToolCall(serverId: string, toolName: string, args: any, requestId: string): Promise<any> {
    const serverConfig = this.config.downstreamServers[serverId];
    if (!serverConfig) {
      throw new Error(`Unknown downstream server: ${serverId}`);
    }

    if (serverConfig.disabled) {
      throw new Error(`Server "${serverId}" is disabled and cannot be called`);
    }

    const circuitBreakerConfig = {
      ...this.config.globalDefaults.circuitBreaker,
      failureThreshold: serverConfig.circuitBreakerThreshold || this.config.globalDefaults.circuitBreaker.failureThreshold
    };
    const connection = await this.connectionPool.createConnection(
      serverId,
      serverConfig,
      circuitBreakerConfig
    );

    const timeout = serverConfig.timeout || this.config.globalDefaults.timeout;
    const retryAttempts = serverConfig.retryAttempts || serverConfig.retries || this.config.globalDefaults.retryAttempts;

    return await connection.circuitBreaker.execute(async () => {
      return await connection.retryEngine.executeWithRetry(
        async () => {
          return await new Promise<any>((resolve, reject) => {
            this.timeoutWatchdog.start(requestId, timeout, () => {
              reject(new Error(`Request timed out after ${timeout}ms`));
            });

            connection.client.request(
              { 
                method: 'tools/call',
                params: {
                  name: toolName,
                  arguments: args
                }
              } as any,
              CallToolResultSchema
            )
            .then((result: any) => {
              this.timeoutWatchdog.cancel(requestId);
              resolve(result);
            })
            .catch((error: any) => {
              this.timeoutWatchdog.cancel(requestId);
              reject(error);
            });
          });
        },
        {
          maxAttempts: retryAttempts,
          baseDelay: this.config.globalDefaults.retryDelay
        },
        {
          requestId,
          serverId,
          tool: toolName
        }
      );
    });
  }

  private createToolName(serverId: string, toolName: string): string {
    const safeServer = serverId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeTool = toolName.replace(/[^a-zA-Z0-9_-]/g, '_');
    let combined = `${safeServer}__${safeTool}`;
    if (combined.length > 64) {
      combined = combined.slice(0, 64);
    }
    return combined;
  }

  private parseToolName(fullName: string): [string | null, string | null] {
    const mapping = this.toolNameMap.get(fullName);
    if (mapping) {
      return [mapping.serverId, mapping.toolName];
    }

    const [serverCandidate, toolCandidate] = fullName.split('__');
    if (!serverCandidate || !toolCandidate) {
      return [null, null];
    }

    return [serverCandidate, toolCandidate];
  }

  async start(): Promise<void> {
    this.logger.info('Starting Common MCP Gateway');

    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    this.logger.info({
      message: 'Common MCP Gateway started successfully',
      downstreamServers: Object.keys(this.config.downstreamServers)
    });

    try {
      await this.refreshToolCache(true);
      this.logger.info('Tools cache initialized successfully');
    } catch (error) {
      this.logger.warn({
        message: 'Failed to initialize tools cache',
        error: (error as Error).message
      });
    }
  }

  private async refreshToolCache(shouldNotify = false): Promise<void> {
    try {
      this.logger.info('Refreshing tool cache from downstream servers');

      this.toolNameMap.clear();
      const allTools: Tool[] = [];

      const connectionPromises = Object.entries(this.config.downstreamServers)
        .filter(([_, serverConfig]) => !serverConfig.disabled)
        .map(async ([serverId, serverConfig]) => {
          try {
            const circuitBreakerConfig = {
              ...this.config.globalDefaults.circuitBreaker,
              failureThreshold: serverConfig.circuitBreakerThreshold || this.config.globalDefaults.circuitBreaker.failureThreshold
            };
            const connection = await this.connectionPool.createConnection(
              serverId,
              serverConfig,
              circuitBreakerConfig
            );

            const result = await connection.client.request(
              { method: 'tools/list' },
              ListToolsResultSchema
            );

            if (result.tools) {
              return result.tools.map((tool) => {
                const prefixedName = this.createToolName(serverId, tool.name);
                this.toolNameMap.set(prefixedName, {
                  serverId,
                  toolName: tool.name
                });

                const baseDescription = tool.description || tool.name;
                const enhancedDescription = `[Server: ${serverId}] ${baseDescription}. Use this tool by calling ${prefixedName}.`;

                return {
                  ...tool,
                  name: prefixedName,
                  description: enhancedDescription
                };
              });
            }
            return [];
          } catch (error) {
            this.logger.error({
              message: 'Failed to list tools from downstream',
              serverId,
              error: (error as Error).message
            });
            return [];
          }
        });

      const results = await Promise.all(connectionPromises);
      results.forEach(tools => allTools.push(...tools));

      this.cachedTools = allTools;

      this.logger.info({
        message: 'Tools cache refreshed',
        totalTools: allTools.length
      });

      if (shouldNotify) {
        await this.sendToolListChangedNotification();
      }
    } catch (error) {
      this.logger.error({
        message: 'Error refreshing tool cache',
        error: (error as Error).message
      });
      throw error;
    }
  }

  private async sendToolListChangedNotification(): Promise<void> {
    if (typeof (this.server as any).sendToolListChanged !== 'function') {
      return;
    }

    try {
      await (this.server as any).sendToolListChanged();
      this.logger.info('tools/list_changed notification sent');
    } catch (error) {
      this.logger.warn({
        message: 'Failed to send tools/list_changed notification',
        error: (error as Error).message
      });
    }
  }

  async stop(): Promise<void> {
    this.logger.info('Stopping Common MCP Gateway');

    this.timeoutWatchdog.cancelAll();
    await this.connectionPool.closeAll();
    await this.server.close();

    this.logger.info('Common MCP Gateway stopped');
  }
}
