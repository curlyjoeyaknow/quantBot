/**
 * Custom Error Classes
 * ====================
 * Standardized error classes for better error handling and debugging.
 */
/**
 * Base application error class
 */
export declare class AppError extends Error {
    readonly code: string;
    readonly statusCode: number;
    readonly context?: Record<string, any>;
    readonly isOperational: boolean;
    constructor(message: string, code?: string, statusCode?: number, context?: Record<string, any>, isOperational?: boolean);
    /**
     * Convert error to JSON for logging
     */
    toJSON(): Record<string, any>;
}
/**
 * Validation error - for input validation failures
 */
export declare class ValidationError extends AppError {
    constructor(message: string, context?: Record<string, any>);
}
/**
 * Not found error - for missing resources
 */
export declare class NotFoundError extends AppError {
    constructor(resource: string, identifier?: string, context?: Record<string, any>);
}
/**
 * Authentication error - for authentication failures
 */
export declare class AuthenticationError extends AppError {
    constructor(message?: string, context?: Record<string, any>);
}
/**
 * Authorization error - for permission failures
 */
export declare class AuthorizationError extends AppError {
    constructor(message?: string, context?: Record<string, any>);
}
/**
 * Database error - for database operation failures
 */
export declare class DatabaseError extends AppError {
    constructor(message: string, operation?: string, context?: Record<string, any>);
}
/**
 * API error - for external API call failures
 */
export declare class ApiError extends AppError {
    readonly apiName?: string;
    readonly apiStatusCode?: number;
    readonly apiResponse?: any;
    constructor(message: string, apiName?: string, apiStatusCode?: number, apiResponse?: any, context?: Record<string, any>);
}
/**
 * Rate limit error - for rate limiting
 */
export declare class RateLimitError extends AppError {
    readonly retryAfter?: number;
    constructor(message?: string, retryAfter?: number, context?: Record<string, any>);
}
/**
 * Configuration error - for configuration issues
 */
export declare class ConfigurationError extends AppError {
    constructor(message: string, configKey?: string, context?: Record<string, any>);
}
/**
 * Service unavailable error - for service unavailability
 */
export declare class ServiceUnavailableError extends AppError {
    constructor(serviceName: string, context?: Record<string, any>);
}
/**
 * Timeout error - for operation timeouts
 */
export declare class TimeoutError extends AppError {
    readonly timeoutMs?: number;
    constructor(message?: string, timeoutMs?: number, context?: Record<string, any>);
}
/**
 * Check if error is an operational error (expected errors that should be handled)
 */
export declare function isOperationalError(error: Error): boolean;
/**
 * Check if error is a retryable error
 */
export declare function isRetryableError(error: Error): boolean;
//# sourceMappingURL=errors.d.ts.map