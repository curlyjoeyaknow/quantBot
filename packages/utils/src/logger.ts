/**
 * Structured Logging System
 * =========================
 * Centralized logging using Winston with structured output, log rotation,
 * and context propagation for better debugging and observability.
 */

import * as winston from 'winston';

const DailyRotateFile =
  require('winston-daily-rotate-file').default || require('winston-daily-rotate-file');
import * as path from 'path';
import * as fs from 'fs';

// Log levels
export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug',
  TRACE = 'trace',
}

// Log context interface
export interface LogContext {
  userId?: number | string;
  requestId?: string;
  tokenAddress?: string;
  callerName?: string;
  strategy?: string;
  sessionId?: string;
  [key: string]: any;
}

// Logger configuration interface
interface LoggerConfig {
  level?: string;
  enableConsole?: boolean;
  enableFile?: boolean;
  logDir?: string;
  maxFiles?: string;
  maxSize?: string;
}

// Default configuration
const defaultConfig: LoggerConfig = {
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  enableConsole: process.env.LOG_CONSOLE !== 'false',
  enableFile: process.env.LOG_FILE !== 'false',
  logDir: process.env.LOG_DIR || path.join(process.cwd(), 'logs'),
  maxFiles: process.env.LOG_MAX_FILES || '14d',
  maxSize: process.env.LOG_MAX_SIZE || '20m',
};

// Create logs directory if it doesn't exist
if (defaultConfig.enableFile && defaultConfig.logDir) {
  if (!fs.existsSync(defaultConfig.logDir)) {
    fs.mkdirSync(defaultConfig.logDir, { recursive: true });
  }
}

// Custom format for structured logging
const structuredFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Console format for development (human-readable)
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
    return `[${timestamp}] ${level}: ${message}${metaStr ? '\n' + metaStr : ''}`;
  })
);

// Create transports array
const transports: winston.transport[] = [];

// Console transport
if (defaultConfig.enableConsole) {
  transports.push(
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'production' ? structuredFormat : consoleFormat,
      level: defaultConfig.level,
    })
  );
}

// File transports with rotation
// Skip file logging in test environment to avoid file system issues
if (defaultConfig.enableFile && defaultConfig.logDir && process.env.NODE_ENV !== 'test') {
  try {
    // Error log file
    transports.push(
      new DailyRotateFile({
        filename: path.join(defaultConfig.logDir, 'error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        format: structuredFormat,
        maxSize: defaultConfig.maxSize,
        maxFiles: defaultConfig.maxFiles,
        zippedArchive: true,
      })
    );

    // Combined log file
    transports.push(
      new DailyRotateFile({
        filename: path.join(defaultConfig.logDir, 'combined-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        format: structuredFormat,
        maxSize: defaultConfig.maxSize,
        maxFiles: defaultConfig.maxFiles,
        zippedArchive: true,
      })
    );
  } catch (error) {
    // Silently fail in test environment
    const nodeEnv = process.env.NODE_ENV as string | undefined;
    if (nodeEnv && nodeEnv !== 'test') {
      console.error('Failed to initialize file transports:', error);
    }
  }
}

// Create Winston logger instance
const winstonLogger = winston.createLogger({
  level: defaultConfig.level,
  format: structuredFormat,
  defaultMeta: { service: 'quantbot' },
  transports,
  // Don't exit on handled exceptions
  exitOnError: false,
});

// Logger class with context support and package namespacing
class Logger {
  private context: LogContext = {};
  private namespace: string = 'quantbot';

  /**
   * Create a logger with a specific namespace (package name)
   */
  constructor(namespace?: string) {
    if (namespace) {
      this.namespace = namespace;
    }
  }

  /**
   * Set context that will be included in all subsequent log messages
   */
  setContext(context: LogContext): void {
    this.context = { ...this.context, ...context };
  }

  /**
   * Clear context
   */
  clearContext(): void {
    this.context = {};
  }

  /**
   * Get current context
   */
  getContext(): LogContext {
    return { ...this.context };
  }

  /**
   * Get the namespace for this logger
   */
  getNamespace(): string {
    return this.namespace;
  }

  /**
   * Merge context for a single log call, including namespace
   */
  private mergeContext(additionalContext?: LogContext): LogContext {
    return {
      namespace: this.namespace,
      ...this.context,
      ...additionalContext,
    };
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error | unknown, context?: LogContext): void {
    const logContext = this.mergeContext(context);

    if (error instanceof Error) {
      winstonLogger.error(message, {
        ...logContext,
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name,
        },
      });
    } else if (error) {
      winstonLogger.error(message, { ...logContext, error });
    } else {
      winstonLogger.error(message, logContext);
    }
  }

  /**
   * Log warning message
   */
  warn(message: string, context?: LogContext): void {
    winstonLogger.warn(message, this.mergeContext(context));
  }

  /**
   * Log info message
   */
  info(message: string, context?: LogContext): void {
    winstonLogger.info(message, this.mergeContext(context));
  }

  /**
   * Log debug message
   */
  debug(message: string, context?: LogContext): void {
    winstonLogger.debug(message, this.mergeContext(context));
  }

  /**
   * Log trace message (most verbose)
   */
  trace(message: string, context?: LogContext): void {
    // Winston doesn't have trace level, use debug
    winstonLogger.debug(message, { ...this.mergeContext(context), level: 'trace' });
  }

  /**
   * Create a child logger with persistent context
   */
  child(context: LogContext): Logger {
    const childLogger = new Logger(this.namespace);
    childLogger.setContext({ ...this.context, ...context });
    return childLogger;
  }
}

// Factory function to create package-specific loggers
export function createLogger(packageName: string): Logger {
  return new Logger(packageName);
}

// Export singleton instance (default logger)
export const logger = new Logger('quantbot');

// Export Logger class for creating child loggers
export { Logger };

// Export winston logger for advanced usage
export { winstonLogger };
