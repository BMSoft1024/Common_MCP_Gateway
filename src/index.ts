#!/usr/bin/env node

import { loadConfig } from './utils/config';
import { initLogger, getLogger } from './utils/logger';
import { CommonMCPGateway } from './gateway/server';

async function main() {
  try {
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

    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down...');
      await gateway.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down...');
      await gateway.stop();
      process.exit(0);
    });

    process.on('uncaughtException', (error) => {
      logger.error({
        message: 'Uncaught exception',
        error: error.message,
        stack: error.stack
      });
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      logger.error({
        message: 'Unhandled rejection',
        reason: String(reason)
      });
      process.exit(1);
    });

  } catch (error) {
    console.error('Fatal error starting gateway:', error);
    process.exit(1);
  }
}

main();
