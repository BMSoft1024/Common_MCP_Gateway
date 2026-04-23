import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { LoggingConfig } from '../types/config';

let logger: winston.Logger | null = null;

export function initLogger(config: LoggingConfig): winston.Logger {
  const logDir = path.dirname(config.file);
  
  const transports: winston.transport[] = [
    new winston.transports.Console({
      // Only log to console if not in STDIO mode (to avoid interfering with MCP protocol)
      silent: true
    })
  ];

  if (config.format === 'json') {
    transports.push(
      new DailyRotateFile({
        dirname: logDir,
        filename: 'common-mcp-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxSize: config.maxSize,
        maxFiles: config.maxFiles,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        )
      })
    );
  } else {
    transports.push(
      new winston.transports.File({
        filename: config.file,
        maxsize: parseSize(config.maxSize),
        maxFiles: config.maxFiles,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.simple()
        )
      })
    );
  }

  logger = winston.createLogger({
    level: config.level.toLowerCase(),
    transports
  });

  return logger;
}

export function getLogger(): winston.Logger {
  if (!logger) {
    throw new Error('Logger not initialized. Call initLogger() first.');
  }
  return logger;
}

function parseSize(size: string): number {
  const match = size.match(/^(\d+)(MB|KB|GB)?$/i);
  if (!match) return 10 * 1024 * 1024; // Default 10MB
  
  const value = parseInt(match[1]);
  const unit = (match[2] || 'MB').toUpperCase();
  
  switch (unit) {
    case 'KB': return value * 1024;
    case 'MB': return value * 1024 * 1024;
    case 'GB': return value * 1024 * 1024 * 1024;
    default: return value * 1024 * 1024;
  }
}
