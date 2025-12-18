/**
 * Centralized Logging System
 * ==========================
 * Package-aware logging with namespaces, aggregation, and monitoring.
 *
 * Usage:
 * ```typescript
 * import { createPackageLogger } from '@quantbot/utils/logging';
 *
 * const logger = createPackageLogger('@quantbot/services');
 * logger.info('Service started', { version: '1.0.0' });
 * ```
 */

import { Logger, createLogger, logger as rootLogger } from '../logger';
import type { LogContext } from '../logger';

/**
 * Package logger registry
 */
const packageLoggers = new Map<string, Logger>();

/**
 * Create or retrieve a package-specific logger
 */
export function createPackageLogger(packageName: string): Logger {
  if (packageLoggers.has(packageName)) {
    return packageLoggers.get(packageName)!;
  }

  const packageLogger = createLogger(packageName);
  packageLoggers.set(packageName, packageLogger);
  return packageLogger;
}

/**
 * Get all registered package loggers
 */
export function getPackageLoggers(): Map<string, Logger> {
  return new Map(packageLoggers);
}

/**
 * Structured log utilities for common operations
 */
export class LogHelpers {
  /**
   * Log API request with standard fields
   */
  static apiRequest(logger: Logger, method: string, url: string, context?: LogContext): void {
    logger.debug('API Request', { method, url, ...context });
  }

  /**
   * Log API response with timing
   */
  static apiResponse(
    logger: Logger,
    method: string,
    url: string,
    statusCode: number,
    duration: number,
    context?: LogContext
  ): void {
    const level = statusCode >= 400 ? 'warn' : 'debug';
    logger[level]('API Response', { method, url, statusCode, duration, ...context });
  }

  /**
   * Log database query with timing
   */
  static dbQuery(
    logger: Logger,
    operation: string,
    table: string,
    duration: number,
    context?: LogContext
  ): void {
    logger.debug('Database Query', { operation, table, duration, ...context });
  }

  /**
   * Log WebSocket event
   */
  static websocketEvent(logger: Logger, event: string, data?: unknown, context?: LogContext): void {
    logger.debug('WebSocket Event', { event, data, ...context });
  }

  /**
   * Log simulation run
   */
  static simulation(
    logger: Logger,
    strategy: string,
    tokenAddress: string,
    result: unknown,
    context?: LogContext
  ): void {
    logger.info('Simulation Completed', { strategy, tokenAddress, result, ...context });
  }

  /**
   * Log cache hit/miss
   */
  static cache(
    logger: Logger,
    operation: 'hit' | 'miss' | 'set' | 'delete',
    key: string,
    context?: LogContext
  ): void {
    logger.debug(`Cache ${operation}`, { key, ...context });
  }

  /**
   * Log performance metric
   */
  static performance(
    logger: Logger,
    operation: string,
    duration: number,
    success: boolean,
    context?: LogContext
  ): void {
    logger.info('Performance Metric', { operation, duration, success, ...context });
  }
}

/**
 * Export all logging utilities
 */
export { Logger, createLogger, rootLogger as logger, LogContext };
export * from '../logger';
export * from '../logging-config';
export * from '../logging-middleware';
export * from './aggregator';
export * from './monitor';
