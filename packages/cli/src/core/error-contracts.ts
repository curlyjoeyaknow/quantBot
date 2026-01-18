/**
 * Error Contracts - Standardized error types with metadata
 *
 * Converts errors to standardized contracts for logging and debugging.
 * All errors are validated against a schema for consistency.
 */

import { z } from 'zod';
import {
  AppError,
  ValidationError,
  TimeoutError,
  NotFoundError,
  ApiError,
  DatabaseError,
} from '@quantbot/infra/utils';

/**
 * Error contract schema (for validation)
 */
export const ErrorContractSchema = z.object({
  code: z.string(),
  message: z.string(),
  operation: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.string(),
  runId: z.string().optional(),
  statusCode: z.number().optional(),
  errorType: z.string().optional(),
});

export type ErrorContract = z.infer<typeof ErrorContractSchema>;

/**
 * Convert error to contract
 *
 * @param error - Error to convert
 * @param operation - Operation name (e.g., 'simulation.run-duckdb')
 * @param runId - Optional run ID
 * @returns Error contract
 */
export function errorToContract(error: unknown, operation: string, runId?: string): ErrorContract {
  const timestamp = new Date().toISOString();

  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      operation,
      metadata: error.context || {},
      timestamp,
      runId,
      statusCode: error.statusCode,
      errorType: error.constructor.name,
    };
  }

  if (error instanceof ValidationError) {
    return {
      code: 'VALIDATION_ERROR',
      message: error.message,
      operation,
      metadata: error.context || {},
      timestamp,
      runId,
      statusCode: error.statusCode,
      errorType: 'ValidationError',
    };
  }

  if (error instanceof TimeoutError) {
    return {
      code: 'TIMEOUT_ERROR',
      message: error.message,
      operation,
      metadata: {
        timeoutMs: error.timeoutMs,
        ...(error.context || {}),
      },
      timestamp,
      runId,
      statusCode: error.statusCode,
      errorType: 'TimeoutError',
    };
  }

  if (error instanceof NotFoundError) {
    return {
      code: 'NOT_FOUND',
      message: error.message,
      operation,
      metadata: error.context || {},
      timestamp,
      runId,
      statusCode: error.statusCode,
      errorType: 'NotFoundError',
    };
  }

  if (error instanceof ApiError) {
    const apiError = error as ApiError;
    return {
      code: 'API_ERROR',
      message: apiError.message,
      operation,
      metadata: {
        apiName: apiError.apiName,
        apiStatusCode: apiError.apiStatusCode,
        ...(apiError.context || {}),
      },
      timestamp,
      runId,
      statusCode: apiError.statusCode,
      errorType: 'ApiError',
    };
  }

  if (error instanceof DatabaseError) {
    const dbError = error as DatabaseError;
    return {
      code: 'DATABASE_ERROR',
      message: dbError.message,
      operation,
      metadata: dbError.context || {},
      timestamp,
      runId,
      statusCode: dbError.statusCode,
      errorType: 'DatabaseError',
    };
  }

  // Unknown error - wrap it
  return {
    code: 'UNKNOWN_ERROR',
    message: error instanceof Error ? error.message : String(error),
    operation,
    metadata: {
      originalError: String(error),
      errorName: error instanceof Error ? error.name : 'Unknown',
      stack: error instanceof Error ? error.stack : undefined,
    },
    timestamp,
    runId,
    errorType: error instanceof Error ? error.constructor.name : 'Unknown',
  };
}

/**
 * Validate error contract
 *
 * @param contract - Contract to validate
 * @returns Validated contract
 * @throws ZodError if validation fails
 */
export function validateErrorContract(contract: unknown): ErrorContract {
  return ErrorContractSchema.parse(contract);
}
