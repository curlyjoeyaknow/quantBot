"use strict";
/**
 * Error Handler
 * =============
 * Centralized error handling utilities and middleware.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleError = handleError;
exports.withErrorHandling = withErrorHandling;
exports.createErrorHandler = createErrorHandler;
exports.safeAsync = safeAsync;
exports.retryWithBackoff = retryWithBackoff;
const errors_1 = require("./errors");
const logger_1 = require("./logger");
/**
 * Handle and log error appropriately
 */
function handleError(error, context) {
    // Convert unknown errors to Error instances
    const err = error instanceof Error ? error : new Error(String(error));
    // Log error with context
    if (err instanceof errors_1.AppError) {
        // Operational errors - log as info/warn
        if (err.isOperational) {
            logger_1.logger.warn('Operational error occurred', {
                ...err.context,
                ...context,
                error: {
                    name: err.name,
                    message: err.message,
                    code: err.code,
                    statusCode: err.statusCode,
                },
            });
        }
        else {
            // Programming errors - log as error
            logger_1.logger.error('Application error occurred', err, {
                ...err.context,
                ...context,
            });
        }
    }
    else {
        // Unknown errors - log as error
        logger_1.logger.error('Unknown error occurred', err, context);
    }
    // Determine if error should be retried
    const shouldRetry = (0, errors_1.isRetryableError)(err);
    const retryAfter = err instanceof errors_1.AppError && 'retryAfter' in err ? err.retryAfter : undefined;
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
function withErrorHandling(fn, context) {
    return (async (...args) => {
        try {
            return await fn(...args);
        }
        catch (error) {
            handleError(error, context);
            throw error;
        }
    });
}
/**
 * Create error handler middleware for Express/Telegraf
 */
function createErrorHandler() {
    return (error, ctx) => {
        const result = handleError(error, { userId: ctx?.from?.id, chatId: ctx?.chat?.id });
        // Send user-friendly message if context is available
        if (ctx && 'reply' in ctx && typeof ctx.reply === 'function') {
            const message = error instanceof errors_1.AppError && error.isOperational
                ? `❌ ${error.message}`
                : '❌ An unexpected error occurred. Please try again later.';
            ctx.reply(message).catch((replyError) => {
                logger_1.logger.error('Failed to send error message to user', replyError);
            });
        }
        return result;
    };
}
/**
 * Safe async wrapper - catches and logs errors without throwing
 */
async function safeAsync(fn, defaultValue, context) {
    try {
        return await fn();
    }
    catch (error) {
        handleError(error, context);
        return defaultValue;
    }
}
/**
 * Retry with exponential backoff
 */
async function retryWithBackoff(fn, maxRetries = 3, initialDelayMs = 1000, context) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
            lastError = error;
            // Don't retry if error is not retryable
            if (!(0, errors_1.isRetryableError)(error instanceof Error ? error : new Error(String(error)))) {
                throw error;
            }
            // Don't retry on last attempt
            if (attempt === maxRetries) {
                break;
            }
            // Calculate delay with exponential backoff
            const delayMs = initialDelayMs * Math.pow(2, attempt);
            logger_1.logger.debug('Retrying after error', {
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
//# sourceMappingURL=error-handler.js.map