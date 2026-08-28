// Logger Utility
// Provides structured logging using winston.
// Sends all output to stderr to avoid corrupting the MCP stdio channel.

import winston from 'winston';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';
export type LogFormat = 'json' | 'simple';

export interface AuditFileOptions {
  filename: string;
  maxSizeBytes: number;
  maxFiles: number;
}

/**
 * Safely serialize an object to avoid circular references.
 */
function safeStringify(obj: any): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (_key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular Reference]';
      }
      seen.add(value);
    }
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack
      };
    }
    return value;
  });
}

export class Logger {
  private winston: winston.Logger;

  constructor(
    level: LogLevel = 'info',
    format: LogFormat = 'json',
    auditFile?: AuditFileOptions
  ) {
    const transports: winston.transport[] = [
      new winston.transports.Console({
        // MCP stdio transport uses stdout for JSON-RPC messages.
        // All log output must go to stderr to avoid corrupting the channel.
        stderrLevels: ['error', 'warn', 'info', 'debug'],
      }),
    ];

    if (auditFile) {
      mkdirSync(dirname(auditFile.filename), { recursive: true });
      const auditEventsOnly = winston.format((info) =>
        typeof info.event === 'string' && info.event.startsWith('mcp_') ? info : false
      );
      transports.push(
        new winston.transports.File({
          filename: auditFile.filename,
          level: 'info',
          maxsize: auditFile.maxSizeBytes,
          maxFiles: auditFile.maxFiles,
          tailable: true,
          format: winston.format.combine(
            auditEventsOnly(),
            winston.format.printf(({ timestamp, level, message, ...meta }) =>
              safeStringify({ level, message, timestamp, ...meta })
            )
          ),
        })
      );
    }

    this.winston = winston.createLogger({
      level,
      format: format === 'json'
        ? winston.format.combine(
            winston.format.timestamp(),
            winston.format.printf(({ timestamp, level, message, ...meta }) => {
              const logObject = {
                level,
                message,
                timestamp,
                ...meta
              };
              return safeStringify(logObject);
            })
          )
        : winston.format.combine(
            winston.format.timestamp(),
            winston.format.printf(({ timestamp, level, message, ...meta }) => {
              const metaStr = Object.keys(meta).length > 0 ? ` ${safeStringify(meta)}` : '';
              return `${timestamp} [${level.toUpperCase()}]: ${message}${metaStr}`;
            })
          ),
      transports,
    });
  }

  error(message: string, meta?: any): void {
    this.winston.error(message, meta);
  }

  warn(message: string, meta?: any): void {
    this.winston.warn(message, meta);
  }

  info(message: string, meta?: any): void {
    this.winston.info(message, meta);
  }

  debug(message: string, meta?: any): void {
    this.winston.debug(message, meta);
  }

  setLevel(level: LogLevel): void {
    this.winston.level = level;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.winston.once('finish', resolve);
      this.winston.end();
    });
  }
}
