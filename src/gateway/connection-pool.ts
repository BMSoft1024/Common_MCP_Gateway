import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn, ChildProcess } from 'child_process';
import { getLogger } from '../utils/logger';
import { DownstreamServerConfig } from '../types/config';
import { CircuitBreaker } from '../middleware/circuit-breaker';
import { RetryEngine } from '../middleware/retry';

export interface DownstreamConnection {
  client: Client;
  process: ChildProcess;
  serverId: string;
  circuitBreaker: CircuitBreaker;
  retryEngine: RetryEngine;
  isConnected: boolean;
}

export class ConnectionPool {
  private connections: Map<string, DownstreamConnection> = new Map();
  private logger = getLogger();

  async createConnection(
    serverId: string,
    config: DownstreamServerConfig,
    circuitBreakerConfig: any
  ): Promise<DownstreamConnection> {
    if (this.connections.has(serverId)) {
      this.logger.warn(`Connection already exists for ${serverId}, returning existing`);
      return this.connections.get(serverId)!;
    }

    this.logger.info({
      message: 'Creating downstream connection',
      serverId,
      command: config.command,
      args: config.args
    });

    try {
      const transport = new StdioClientTransport({
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
        process: null as any,
        serverId,
        circuitBreaker: new CircuitBreaker(serverId, circuitBreakerConfig),
        retryEngine: new RetryEngine(),
        isConnected: true
      };

      this.connections.set(serverId, connection);

      this.logger.info({
        message: 'Downstream connection established',
        serverId
      });

      return connection;
    } catch (error) {
      this.logger.error({
        message: 'Failed to create downstream connection',
        serverId,
        error: (error as Error).message
      });
      throw error;
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

  getActiveConnectionCount(): number {
    return Array.from(this.connections.values()).filter(c => c.isConnected).length;
  }

  getAllServerIds(): string[] {
    return Array.from(this.connections.keys());
  }
}
