/**
 * Error Handler Middleware
 * ========================
 * Centralized error handling for API routes
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiError } from '../errors/api-errors';

/**
 * Standard error response format
 */
export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
    timestamp: string;
    path?: string;
  };
}

/**
 * Error handler for API routes
 */
export async function handleApiError(
  error: unknown,
  request: NextRequest
): Promise<NextResponse<ApiErrorResponse>> {
  const path = request.nextUrl.pathname;
  const timestamp = new Date().toISOString();

  // Handle known error types
  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        error: {
          code: error.name.toUpperCase().replace('ERROR', ''),
          message: error.message,
          details: error.details,
          timestamp,
          path,
        },
      },
      { status: error.statusCode }
    );
  }

  // Handle validation errors (Zod)
  if (error && typeof error === 'object' && 'issues' in error) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: (error as any).issues,
          timestamp,
          path,
        },
      },
      { status: 400 }
    );
  }

  // Handle generic errors
  const message = error instanceof Error ? error.message : 'An unexpected error occurred';
  const code = error instanceof Error && 'code' in error ? String(error.code) : 'INTERNAL_ERROR';

  // Log error with structured logging
  try {
    const { logger } = await import('../logging/logger');
    logger.error('API Error', error, {
      path,
      timestamp,
    });
  } catch {
    // Fallback to console if logger not available
    console.error('API Error:', {
      path,
      error: error instanceof Error ? error.stack : error,
      timestamp,
    });
  }

  // Don't expose internal errors in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  const exposedMessage = isDevelopment ? message : 'An internal error occurred';

  return NextResponse.json(
    {
      error: {
        code,
        message: exposedMessage,
        ...(isDevelopment && { details: error }),
        timestamp,
        path,
      },
    },
    { status: 500 }
  );
}

/**
 * Wrapper for async route handlers with error handling
 */
export function withErrorHandling(
  handler: (request: NextRequest) => Promise<NextResponse>
) {
  return async (request: NextRequest) => {
    try {
      return await handler(request);
    } catch (error) {
      return await handleApiError(error, request);
    }
  };
}

