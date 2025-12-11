"use strict";
/**
 * Custom Error Classes
 * ====================
 * Standardized error classes for better error handling and debugging.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimeoutError = exports.ServiceUnavailableError = exports.ConfigurationError = exports.RateLimitError = exports.ApiError = exports.DatabaseError = exports.AuthorizationError = exports.AuthenticationError = exports.NotFoundError = exports.ValidationError = exports.AppError = void 0;
exports.isOperationalError = isOperationalError;
exports.isRetryableError = isRetryableError;
/**
 * Base application error class
 */
class AppError extends Error {
    constructor(message, code = 'APP_ERROR', statusCode = 500, context, isOperational = true) {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
        this.statusCode = statusCode;
        this.context = context;
        this.isOperational = isOperational;
        // Maintains proper stack trace for where our error was thrown
        Error.captureStackTrace(this, this.constructor);
    }
    /**
     * Convert error to JSON for logging
     */
    toJSON() {
        return {
            name: this.name,
            message: this.message,
            code: this.code,
            statusCode: this.statusCode,
            context: this.context,
            isOperational: this.isOperational,
            stack: this.stack,
        };
    }
}
exports.AppError = AppError;
/**
 * Validation error - for input validation failures
 */
class ValidationError extends AppError {
    constructor(message, context) {
        super(message, 'VALIDATION_ERROR', 400, context);
    }
}
exports.ValidationError = ValidationError;
/**
 * Not found error - for missing resources
 */
class NotFoundError extends AppError {
    constructor(resource, identifier, context) {
        const message = identifier
            ? `${resource} with identifier '${identifier}' not found`
            : `${resource} not found`;
        super(message, 'NOT_FOUND', 404, { resource, identifier, ...context });
    }
}
exports.NotFoundError = NotFoundError;
/**
 * Authentication error - for authentication failures
 */
class AuthenticationError extends AppError {
    constructor(message = 'Authentication failed', context) {
        super(message, 'AUTHENTICATION_ERROR', 401, context);
    }
}
exports.AuthenticationError = AuthenticationError;
/**
 * Authorization error - for permission failures
 */
class AuthorizationError extends AppError {
    constructor(message = 'Insufficient permissions', context) {
        super(message, 'AUTHORIZATION_ERROR', 403, context);
    }
}
exports.AuthorizationError = AuthorizationError;
/**
 * Database error - for database operation failures
 */
class DatabaseError extends AppError {
    constructor(message, operation, context) {
        super(message, 'DATABASE_ERROR', 500, { operation, ...context });
    }
}
exports.DatabaseError = DatabaseError;
/**
 * API error - for external API call failures
 */
class ApiError extends AppError {
    constructor(message, apiName, apiStatusCode, apiResponse, context) {
        super(message, 'API_ERROR', 502, { apiName, apiStatusCode, ...context });
        this.apiName = apiName;
        this.apiStatusCode = apiStatusCode;
        this.apiResponse = apiResponse;
    }
}
exports.ApiError = ApiError;
/**
 * Rate limit error - for rate limiting
 */
class RateLimitError extends AppError {
    constructor(message = 'Rate limit exceeded', retryAfter, context) {
        super(message, 'RATE_LIMIT_ERROR', 429, { retryAfter, ...context });
        this.retryAfter = retryAfter;
    }
}
exports.RateLimitError = RateLimitError;
/**
 * Configuration error - for configuration issues
 */
class ConfigurationError extends AppError {
    constructor(message, configKey, context) {
        super(message, 'CONFIGURATION_ERROR', 500, { configKey, ...context });
    }
}
exports.ConfigurationError = ConfigurationError;
/**
 * Service unavailable error - for service unavailability
 */
class ServiceUnavailableError extends AppError {
    constructor(serviceName, context) {
        super(`Service '${serviceName}' is currently unavailable`, 'SERVICE_UNAVAILABLE', 503, {
            serviceName,
            ...context,
        });
    }
}
exports.ServiceUnavailableError = ServiceUnavailableError;
/**
 * Timeout error - for operation timeouts
 */
class TimeoutError extends AppError {
    constructor(message = 'Operation timed out', timeoutMs, context) {
        super(message, 'TIMEOUT_ERROR', 504, { timeoutMs, ...context });
        this.timeoutMs = timeoutMs;
    }
}
exports.TimeoutError = TimeoutError;
/**
 * Check if error is an operational error (expected errors that should be handled)
 */
function isOperationalError(error) {
    if (error instanceof AppError) {
        return error.isOperational;
    }
    return false;
}
/**
 * Check if error is a retryable error
 */
function isRetryableError(error) {
    if (error instanceof AppError) {
        return (error instanceof ApiError ||
            error instanceof DatabaseError ||
            error instanceof ServiceUnavailableError ||
            error instanceof TimeoutError);
    }
    return false;
}
//# sourceMappingURL=errors.js.map