#!/usr/bin/env node

import './utils/hide-windows';
import { loadConfig } from './utils/config';
import { initLogger, getLogger } from './utils/logger';
import { CommonMCPGateway } from './gateway/server';
import { runBridge } from './daemon/bridge';

async function main() {
  try {
    // Default: thin bridge to the shared daemon (one downstream server per kind, whatever the client count).
    // COMMON_MCP_MODE=standalone, or an unreachable daemon, keeps the previous in-process gateway.
    if (process.env.COMMON_MCP_MODE !== 'standalone' && await runBridge())
      return;

    const config = loadConfig();
    initLogger(config.logging);
    const logger = getLogger();

    logger.info('Common MCP Gateway starting...');
    logger.info({
      message: 'Configuration loaded',
      version: config.version,
      downstreamServers: Object.keys(config.downstreamServers),
      timeout: config.globalDefaults.timeout,
      retryAttempts: config.globalDefaults.retryAttempts
    });

    const gateway = new CommonMCPGateway(config);
    
    await gateway.start();

    let shuttingDown = false;
    const shutdown = async (reason: string, code: number) => {
      if (shuttingDown)
        return;

      shuttingDown = true;
      logger.info(`${reason}, shutting down...`);

      try {
        await Promise.race([gateway.stop(), new Promise(resolve => setTimeout(resolve, 5000))]);
      } finally {
        process.exit(code);
      }
    };

    process.on('SIGINT', () => void shutdown('Received SIGINT', 0));
    process.on('SIGTERM', () => void shutdown('Received SIGTERM', 0));

    // Clients (Claude Desktop, Devin) end the gateway by closing its stdin, no signal is sent on Windows.
    process.stdin.on('end', () => void shutdown('Client closed stdin', 0));
    process.stdin.on('close', () => void shutdown('Client closed stdin', 0));

    // Last resort: whatever path ends the process, no downstream server may outlive the gateway.
    process.on('exit', () => gateway.killDownstreamSync());

    process.on('uncaughtException', (error) => {
      logger.error({
        message: 'Uncaught exception',
        error: error.message,
        stack: error.stack
      });
      void shutdown('Uncaught exception', 1);
    });

    process.on('unhandledRejection', (reason) => {
      logger.error({
        message: 'Unhandled rejection',
        reason: String(reason)
      });
      void shutdown('Unhandled rejection', 1);
    });

  } catch (error) {
    console.error('Fatal error starting gateway:', error);
    process.exit(1);
  }
}

main();
