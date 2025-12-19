/**
 * Logging Middleware
 * ==================
 * Middleware utilities for request/response logging and context propagation.
 */

import { logger, LogContext } from './logger.js';
import { randomBytes } from 'crypto';

/**
 * Request context interface
 */
export interface RequestContext extends LogContext {
  method?: string;
  path?: string;
  statusCode?: number;
  duration?: number;
  ip?: string;
  userAgent?: string;
}

/**
 * Create request ID for tracking
 */
export function createRequestId(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Log incoming request
 */
export function logRequest(context: RequestContext): void {
  logger.info('Incoming request', {
    method: context.method,
    path: context.path,
    requestId: context.requestId,
    ip: context.ip,
    userAgent: context.userAgent,
  });
}

/**
 * Log outgoing response
 */
export function logResponse(context: RequestContext): void {
  const level = context.statusCode && context.statusCode >= 400 ? 'warn' : 'info';
  logger[level]('Request completed', {
    method: context.method,
    path: context.path,
    statusCode: context.statusCode,
    duration: context.duration,
    requestId: context.requestId,
  });
}

/**
 * Log error with request context
 */
export function logError(error: Error | unknown, context: RequestContext): void {
  logger.error('Request error', error, {
    method: context.method,
    path: context.path,
    requestId: context.requestId,
    statusCode: context.statusCode,
  });
}

/**
 * Performance logging decorator
 */
export function logPerformance<T extends (...args: Array<unknown>) => Promise<unknown>>(
  fn: T,
  operation: string,
  context?: LogContext
): T {
  return (async (...args: Array<unknown>) => {
    const startTime = Date.now();
    const requestId = context?.requestId || createRequestId();

    logger.debug(`Starting ${operation}`, { ...context, requestId });

    try {
      const result = await fn(...args);
      const duration = Date.now() - startTime;

      logger.debug(`Completed ${operation}`, {
        ...context,
        requestId,
        duration,
        success: true,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error(`Failed ${operation}`, error as Error, {
        ...context,
        requestId,
        duration,
        success: false,
      });

      throw error;
    }
  }) as T;
}
