/**
 * Error Handler
 * =============
 * Centralized error handling utilities and middleware.
 */

import { AppError, isOperationalError, isRetryableError, RateLimitError } from './errors';
import { logger } from './logger';

/**
 * Error handler result
 */
export interface ErrorHandlerResult {
  handled: boolean;
  message?: string;
  shouldRetry?: boolean;
  retryAfter?: number;
}

/**
 * Handle and log error appropriately
 */
export function handleError(
  error: Error | unknown,
  context?: Record<string, unknown>
): ErrorHandlerResult {
  // Convert unknown errors to Error instances
  const err = error instanceof Error ? error : new Error(String(error));

  // Log error with context
  if (err instanceof AppError) {
    // Operational errors - log as info/warn
    if (err.isOperational) {
      logger.warn('Operational error occurred', {
        ...err.context,
        ...context,
        error: {
          name: err.name,
          message: err.message,
          code: err.code,
          statusCode: err.statusCode,
        },
      });
    } else {
      // Programming errors - log as error
      logger.error('Application error occurred', err, {
        ...err.context,
        ...context,
      });
    }
  } else {
    // Unknown errors - log as error
    logger.error('Unknown error occurred', err, context);
  }

  // Determine if error should be retried
  const shouldRetry = isRetryableError(err);
  const retryAfter = err instanceof RateLimitError ? err.retryAfter : undefined;

  return {
    handled: true,
    message: err.message,
    shouldRetry,
    retryAfter,
  };
}

/**
 * Wrap async function with error handling
 */
export function withErrorHandling<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  context?: Record<string, unknown>
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      handleError(error, context);
      throw error;
    }
  }) as T;
}

/**
 * Create error handler middleware for Express/Telegraf
 */
export function createErrorHandler() {
  return (error: Error | unknown, ctx?: unknown) => {
    const result = handleError(error, { userId: ctx?.from?.id, chatId: ctx?.chat?.id });

    // Send user-friendly message if context is available
    if (ctx && 'reply' in ctx && typeof ctx.reply === 'function') {
      const message =
        error instanceof AppError && error.isOperational
          ? `❌ ${error.message}`
          : '❌ An unexpected error occurred. Please try again later.';

      ctx.reply(message).catch((replyError: Error) => {
        logger.error('Failed to send error message to user', replyError);
      });
    }

    return result;
  };
}

/**
 * Safe async wrapper - catches and logs errors without throwing
 */
export async function safeAsync<T>(
  fn: () => Promise<T>,
  defaultValue: T,
  context?: Record<string, unknown>
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    handleError(error, context);
    return defaultValue;
  }
}

/**
 * Retry with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelayMs: number = 1000,
  context?: Record<string, unknown>
): Promise<T> {
  let lastError: Error | unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry if error is not retryable
      if (!isRetryableError(error instanceof Error ? error : new Error(String(error)))) {
        throw error;
      }

      // Don't retry on last attempt
      if (attempt === maxRetries) {
        break;
      }

      // Calculate delay with exponential backoff
      const delayMs = initialDelayMs * Math.pow(2, attempt);
      logger.debug('Retrying after error', {
        attempt: attempt + 1,
        maxRetries,
        delayMs,
        ...context,
      });

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // All retries exhausted
  handleError(lastError, { ...context, maxRetries });
  throw lastError;
}
