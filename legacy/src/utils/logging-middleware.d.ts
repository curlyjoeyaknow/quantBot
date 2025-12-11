/**
 * Logging Middleware
 * ==================
 * Middleware utilities for request/response logging and context propagation.
 */
import { LogContext } from './logger';
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
export declare function createRequestId(): string;
/**
 * Log incoming request
 */
export declare function logRequest(context: RequestContext): void;
/**
 * Log outgoing response
 */
export declare function logResponse(context: RequestContext): void;
/**
 * Log error with request context
 */
export declare function logError(error: Error | unknown, context: RequestContext): void;
/**
 * Performance logging decorator
 */
export declare function logPerformance<T extends (...args: any[]) => Promise<any>>(fn: T, operation: string, context?: LogContext): T;
//# sourceMappingURL=logging-middleware.d.ts.map