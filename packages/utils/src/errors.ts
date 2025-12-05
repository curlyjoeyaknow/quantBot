/**
 * Custom Error Classes
 * ====================
 * Standardized error classes for better error handling and debugging.
 */

/**
 * Base application error class
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly context?: Record<string, any>;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    code: string = 'APP_ERROR',
    statusCode: number = 500,
    context?: Record<string, any>,
    isOperational: boolean = true
  ) {
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
  toJSON(): Record<string, any> {
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

/**
 * Validation error - for input validation failures
 */
export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'VALIDATION_ERROR', 400, context);
  }
}

/**
 * Not found error - for missing resources
 */
export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string, context?: Record<string, any>) {
    const message = identifier
      ? `${resource} with identifier '${identifier}' not found`
      : `${resource} not found`;
    super(message, 'NOT_FOUND', 404, { resource, identifier, ...context });
  }
}

/**
 * Authentication error - for authentication failures
 */
export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication failed', context?: Record<string, any>) {
    super(message, 'AUTHENTICATION_ERROR', 401, context);
  }
}

/**
 * Authorization error - for permission failures
 */
export class AuthorizationError extends AppError {
  constructor(message: string = 'Insufficient permissions', context?: Record<string, any>) {
    super(message, 'AUTHORIZATION_ERROR', 403, context);
  }
}

/**
 * Database error - for database operation failures
 */
export class DatabaseError extends AppError {
  constructor(message: string, operation?: string, context?: Record<string, any>) {
    super(message, 'DATABASE_ERROR', 500, { operation, ...context });
  }
}

/**
 * API error - for external API call failures
 */
export class ApiError extends AppError {
  public readonly apiName?: string;
  public readonly apiStatusCode?: number;
  public readonly apiResponse?: any;

  constructor(
    message: string,
    apiName?: string,
    apiStatusCode?: number,
    apiResponse?: any,
    context?: Record<string, any>
  ) {
    super(message, 'API_ERROR', 502, { apiName, apiStatusCode, ...context });
    this.apiName = apiName;
    this.apiStatusCode = apiStatusCode;
    this.apiResponse = apiResponse;
  }
}

/**
 * Rate limit error - for rate limiting
 */
export class RateLimitError extends AppError {
  public readonly retryAfter?: number;

  constructor(message: string = 'Rate limit exceeded', retryAfter?: number, context?: Record<string, any>) {
    super(message, 'RATE_LIMIT_ERROR', 429, { retryAfter, ...context });
    this.retryAfter = retryAfter;
  }
}

/**
 * Configuration error - for configuration issues
 */
export class ConfigurationError extends AppError {
  constructor(message: string, configKey?: string, context?: Record<string, any>) {
    super(message, 'CONFIGURATION_ERROR', 500, { configKey, ...context });
  }
}

/**
 * Service unavailable error - for service unavailability
 */
export class ServiceUnavailableError extends AppError {
  constructor(serviceName: string, context?: Record<string, any>) {
    super(`Service '${serviceName}' is currently unavailable`, 'SERVICE_UNAVAILABLE', 503, {
      serviceName,
      ...context,
    });
  }
}

/**
 * Timeout error - for operation timeouts
 */
export class TimeoutError extends AppError {
  public readonly timeoutMs?: number;

  constructor(message: string = 'Operation timed out', timeoutMs?: number, context?: Record<string, any>) {
    super(message, 'TIMEOUT_ERROR', 504, { timeoutMs, ...context });
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Check if error is an operational error (expected errors that should be handled)
 */
export function isOperationalError(error: Error): boolean {
  if (error instanceof AppError) {
    return error.isOperational;
  }
  return false;
}

/**
 * Check if error is a retryable error
 */
export function isRetryableError(error: Error): boolean {
  if (error instanceof AppError) {
    return (
      error instanceof ApiError ||
      error instanceof DatabaseError ||
      error instanceof ServiceUnavailableError ||
      error instanceof TimeoutError
    );
  }
  return false;
}

