/**
 * Next.js Logger Adapter
 * ======================
 * Logger adapter for Next.js API routes and server components.
 * Provides the same structured logging interface as the main logger.
 */

import { logger as baseLogger, LogContext } from './logger';

/**
 * Next.js-specific logger with request context support
 */
export class NextJSLogger {
  /**
   * Create a logger with request context
   */
  static withRequest(requestId: string, additionalContext?: LogContext) {
    const contextLogger = baseLogger.child({
      requestId,
      ...additionalContext,
    });
    return contextLogger;
  }

  /**
   * Log error with Next.js context
   */
  static error(message: string, error?: Error | unknown, context?: LogContext): void {
    baseLogger.error(message, error, context);
  }

  /**
   * Log warning with Next.js context
   */
  static warn(message: string, context?: LogContext): void {
    baseLogger.warn(message, context);
  }

  /**
   * Log info with Next.js context
   */
  static info(message: string, context?: LogContext): void {
    baseLogger.info(message, context);
  }

  /**
   * Log debug with Next.js context
   */
  static debug(message: string, context?: LogContext): void {
    baseLogger.debug(message, context);
  }
}

/**
 * Export singleton for convenience
 */
export const logger = NextJSLogger;
