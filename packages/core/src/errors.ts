/**
 * Core Error Classes
 *
 * Simple error classes for @quantbot/core.
 * This package has zero dependencies on other @quantbot packages,
 * so we define minimal error classes here rather than importing from infra.
 */

/**
 * Validation error - for input validation failures
 *
 * Simple error class compatible with @quantbot/infra/utils ValidationError
 * but defined here to maintain @quantbot/core's zero-dependency policy.
 */
export class ValidationError extends Error {
  public readonly context?: Record<string, unknown>;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = 'ValidationError';
    this.context = context;

    // Maintains proper stack trace for where our error was thrown
    Error.captureStackTrace(this, this.constructor);
  }
}
