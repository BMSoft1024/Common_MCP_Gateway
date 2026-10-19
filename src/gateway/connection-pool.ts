import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { getLogger } from '../utils/logger';
import { killProcessTree } from '../utils/process-tree';
import { toolsCacheKey, writeToolsCache } from '../utils/tools-cache';
import { DownstreamServerConfig } from '../types/config';
import { CircuitBreaker } from '../middleware/circuit-breaker';
import { RetryEngine } from '../middleware/retry';

export interface DownstreamConnection {
  client: Client;
  transport: StdioClientTransport;
  serverId: string;
  pid?: number | null;
  lastUsedAt: number;
  circuitBreaker: CircuitBreaker;
  retryEngine: RetryEngine;
  isConnected: boolean;
}

export class ConnectionPool {
  private connections: Map<string, DownstreamConnection> = new Map();
  private pending: Map<string, Promise<DownstreamConnection>> = new Map();
  private logger = getLogger();
  private serverEnabledFilter?: (serverId: string) => boolean;
  private idleTimer?: NodeJS.Timeout;

  /** Downstream servers idle for this long are stopped; the next call starts them again. */
  private static readonly IDLE_MS = Number(process.env.COMMON_MCP_IDLE_MS) || 10 * 60 * 1000;

  constructor() {
    this.idleTimer = setInterval(() => void this.closeIdle(), 60 * 1000);
    this.idleTimer.unref();
  }

  private async closeIdle(): Promise<void> {
    const cutoff = Date.now() - ConnectionPool.IDLE_MS;
    for (const [serverId, connection] of Array.from(this.connections.entries())) {
      if (connection.lastUsedAt < cutoff) {
        this.logger.info({ message: 'Closing idle downstream connection', serverId });
        await this.closeConnection(serverId);
      }
    }
  }

  setServerEnabledFilter(filter: (serverId: string) => boolean): void {
    this.serverEnabledFilter = filter;
  }

  /** Sessions sharing one pool must not spawn the same downstream server twice, so concurrent requests join one connect. */
  createConnection(serverId: string, config: DownstreamServerConfig, circuitBreakerConfig: any): Promise<DownstreamConnection> {
    const inFlight = this.pending.get(serverId);
    if (inFlight)
      return inFlight;

    const attempt = this.createConnectionInner(serverId, config, circuitBreakerConfig).finally(() => this.pending.delete(serverId));
    this.pending.set(serverId, attempt);
    return attempt;
  }

  private async createConnectionInner(
    serverId: string,
    config: DownstreamServerConfig,
    circuitBreakerConfig: any
  ): Promise<DownstreamConnection> {
    if (config.disabled) {
      throw new Error(`Server "${serverId}" is disabled and cannot create connection`);
    }

    if (this.serverEnabledFilter && !this.serverEnabledFilter(serverId)) {
      throw new Error(`Server "${serverId}" is disabled by gate policy and cannot create connection`);
    }

    if (this.connections.has(serverId)) {
      const existingConnection = this.connections.get(serverId)!;
      
      // Check if connection is still alive
      if (existingConnection.isConnected) {
        try {
          // Actually probe the downstream server instead of trusting the cached flag,
          // since the child process can die without isConnected ever flipping to false.
          await existingConnection.client.ping();

          this.logger.debug(`Connection already exists for ${serverId}, returning existing`);
          existingConnection.lastUsedAt = Date.now();
          return existingConnection;
        } catch (error) {
          // Connection is stale, close and recreate
          this.logger.warn({
            message: 'Cached connection is stale, recreating',
            serverId,
            error: (error as Error).message
          });
          await this.closeConnection(serverId);
          // Continue to create new connection below
        }
      } else {
        // Connection marked as disconnected, remove and recreate
        this.logger.warn(`Connection for ${serverId} is disconnected, recreating`);
        this.connections.delete(serverId);
      }
    }

    this.logger.info({
      message: 'Creating downstream connection',
      serverId,
      command: config.command,
      args: config.args
    });

    let transport: StdioClientTransport | undefined;

    try {
      transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env
      });

      const client = new Client(
        {
          name: `common-mcp-gateway-${serverId}`,
          version: '1.0.0'
        },
        {
          capabilities: {}
        }
      );

      await client.connect(transport);

      const connection: DownstreamConnection = {
        client,
        transport,
        serverId,
        pid: transport.pid,
        lastUsedAt: Date.now(),
        circuitBreaker: new CircuitBreaker(serverId, circuitBreakerConfig),
        retryEngine: new RetryEngine(),
        isConnected: true
      };

      this.connections.set(serverId, connection);

      client.onclose = () => {
        connection.isConnected = false;
        connection.pid = undefined;
      };

      this.logger.info({
        message: 'Downstream connection established',
        serverId
      });

      void this.refreshToolsCache(serverId, config, client);

      return connection;
    } catch (error) {
      // A failed connect (e.g. handshake timeout) leaves the spawned process running, so every retry or
      // tools/list refresh would leak one more downstream process tree.
      killProcessTree(transport?.pid);
      try {
        await transport?.close();
      } catch {
        // best effort
      }

      this.logger.error({
        message: 'Failed to create downstream connection',
        serverId,
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * A server that has just been started reports its CURRENT tools, so the shared cache is refreshed for free.
   * This is what makes new tools of unpinned servers (npx package@latest, remote servers) appear without waiting
   * for the cache entry to expire.
   */
  private async refreshToolsCache(serverId: string, config: DownstreamServerConfig, client: Client): Promise<void> {
    try {
      const listed = await client.request({ method: 'tools/list' }, ListToolsResultSchema);
      writeToolsCache(serverId, toolsCacheKey(config), listed.tools ?? []);
    } catch {
      // the cache is an optimisation, a failing tools/list must never affect the connection
    }
  }

  getConnection(serverId: string): DownstreamConnection | undefined {
    return this.connections.get(serverId);
  }

  async closeConnection(serverId: string): Promise<void> {
    const connection = this.connections.get(serverId);
    if (!connection) {
      this.logger.warn(`No connection found for ${serverId}`);
      return;
    }

    this.logger.info({
      message: 'Closing downstream connection',
      serverId
    });

    try {
      // Kill while the launcher still exists: once it is gone its children are re-parented and can no longer be found.
      killProcessTree(connection.pid);
      await connection.client.close();
      connection.isConnected = false;
      this.connections.delete(serverId);

      this.logger.info({
        message: 'Downstream connection closed',
        serverId
      });
    } catch (error) {
      this.logger.error({
        message: 'Error closing downstream connection',
        serverId,
        error: (error as Error).message
      });
    }
  }

  async closeAll(): Promise<void> {
    this.logger.info(`Closing all ${this.connections.size} downstream connections`);
    const promises = Array.from(this.connections.keys()).map(serverId =>
      this.closeConnection(serverId)
    );
    await Promise.all(promises);
  }

  /** Synchronous last-resort cleanup for process 'exit' handlers, where async work cannot run. */
  killAllSync(): void {
    for (const connection of this.connections.values())
      killProcessTree(connection.pid);

    this.connections.clear();
  }

  getActiveConnectionCount(): number {
    return Array.from(this.connections.values()).filter(c => c.isConnected).length;
  }

  getAllServerIds(): string[] {
    return Array.from(this.connections.keys());
  }
}
