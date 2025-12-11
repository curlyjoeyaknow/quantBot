/**
 * Error Handler
 * =============
 * Centralized error handling utilities and middleware.
 */
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
export declare function handleError(error: Error | unknown, context?: Record<string, any>): ErrorHandlerResult;
/**
 * Wrap async function with error handling
 */
export declare function withErrorHandling<T extends (...args: any[]) => Promise<any>>(fn: T, context?: Record<string, any>): T;
/**
 * Create error handler middleware for Express/Telegraf
 */
export declare function createErrorHandler(): (error: Error | unknown, ctx?: any) => ErrorHandlerResult;
/**
 * Safe async wrapper - catches and logs errors without throwing
 */
export declare function safeAsync<T>(fn: () => Promise<T>, defaultValue: T, context?: Record<string, any>): Promise<T>;
/**
 * Retry with exponential backoff
 */
export declare function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries?: number, initialDelayMs?: number, context?: Record<string, any>): Promise<T>;
//# sourceMappingURL=error-handler.d.ts.map