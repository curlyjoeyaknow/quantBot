/**
 * Structured Logging
 * ==================
 * Centralized logging with request ID tracking
 */

import { getCurrentRequestId } from '../middleware/request-id';

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  requestId?: string;
  [key: string]: any;
}

class Logger {
  private formatLog(level: LogLevel, message: string, meta?: any): LogEntry {
    const requestId = getCurrentRequestId();
    return {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...(requestId && { requestId }),
      ...meta,
    };
  }

  private log(level: LogLevel, message: string, meta?: any): void {
    const entry = this.formatLog(level, message, meta);
    const logString = JSON.stringify(entry);
    
    // In production, use proper log levels
    if (level === LogLevel.ERROR) {
      console.error(logString);
    } else if (level === LogLevel.WARN) {
      console.warn(logString);
    } else {
      console.log(logString);
    }
  }

  debug(message: string, meta?: any): void {
    if (process.env.NODE_ENV === 'development') {
      this.log(LogLevel.DEBUG, message, meta);
    }
  }

  info(message: string, meta?: any): void {
    this.log(LogLevel.INFO, message, meta);
  }

  warn(message: string, meta?: any): void {
    this.log(LogLevel.WARN, message, meta);
  }

  error(message: string, error?: Error | unknown, meta?: any): void {
    const errorMeta: any = { ...meta };
    
    if (error instanceof Error) {
      errorMeta.error = {
        name: error.name,
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      };
    } else if (error) {
      errorMeta.error = error;
    }
    
    this.log(LogLevel.ERROR, message, errorMeta);
  }
}

export const logger = new Logger();

/**
 * Create a logger with context
 */
export function createLogger(context: Record<string, any>) {
  return {
    debug: (message: string, meta?: any) => logger.debug(message, { ...context, ...meta }),
    info: (message: string, meta?: any) => logger.info(message, { ...context, ...meta }),
    warn: (message: string, meta?: any) => logger.warn(message, { ...context, ...meta }),
    error: (message: string, error?: Error | unknown, meta?: any) => logger.error(message, error, { ...context, ...meta }),
  };
}

