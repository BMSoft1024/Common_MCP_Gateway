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
  private toolNameMap: Map<string, ToolMapping>;

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
          tools: {}
        }
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      this.logger.info('Handling list_tools request');

      try {
        this.toolNameMap.clear();
        const allTools: Tool[] = [];
        
        // Create all connections in parallel for faster startup
        // CRITICAL: Filter out disabled servers!
        const connectionPromises = Object.entries(this.config.downstreamServers)
          .filter(([_, serverConfig]) => !serverConfig.disabled)
          .map(
          async ([serverId, serverConfig]) => {
            try {
              const connection = await this.connectionPool.createConnection(
                serverId,
                serverConfig,
                this.config.globalDefaults.circuitBreaker
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

                  // Enhanced description for better model understanding
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
          }
        );

        const results = await Promise.all(connectionPromises);
        results.forEach(tools => allTools.push(...tools));

        this.logger.info({
          message: 'Tools listed successfully',
          totalTools: allTools.length
        });

        return { tools: allTools };
      } catch (error) {
        this.logger.error({
          message: 'Error listing tools',
          error: (error as Error).message
        });
        throw error;
      }
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
        throw new Error(`Invalid tool name format: ${name}. Expected: serverId/toolName`);
      }

      const serverConfig = this.config.downstreamServers[serverId];
      if (!serverConfig) {
        throw new Error(`Unknown downstream server: ${serverId}`);
      }

      try {
        const connection = await this.connectionPool.createConnection(
          serverId,
          serverConfig,
          this.config.globalDefaults.circuitBreaker
        );

        const timeout = serverConfig.timeout || this.config.globalDefaults.timeout;
        const retryAttempts = serverConfig.retryAttempts || this.config.globalDefaults.retryAttempts;

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
        throw error;
      }
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
  }

  async stop(): Promise<void> {
    this.logger.info('Stopping Common MCP Gateway');

    this.timeoutWatchdog.cancelAll();
    await this.connectionPool.closeAll();
    await this.server.close();

    this.logger.info('Common MCP Gateway stopped');
  }
}
