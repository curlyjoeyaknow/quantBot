/**
 * Validation Middleware
 * =====================
 * Request validation using Zod schemas
 */

import { NextRequest, NextResponse } from 'next/server';
import { ZodSchema, ZodError } from 'zod';
import { handleApiError } from './error-handler';

/**
 * Validate request body against Zod schema
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return async (request: NextRequest): Promise<{ data: T; error: NextResponse | null }> => {
    try {
      const body = await request.json();
      const data = schema.parse(body);
      return { data, error: null };
    } catch (error) {
      if (error instanceof ZodError) {
        return {
          data: null as any,
          error: NextResponse.json(
            {
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Invalid request body',
                details: error.issues,
                timestamp: new Date().toISOString(),
                path: request.nextUrl.pathname,
              },
            },
            { status: 400 }
          ),
        };
      }
      throw error;
    }
  };
}

/**
 * Validate query parameters against Zod schema
 */
export function validateQuery<T>(schema: ZodSchema<T>) {
  return (request: NextRequest): { data: T; error: NextResponse | null } => {
    try {
      const params = Object.fromEntries(request.nextUrl.searchParams);
      const data = schema.parse(params);
      return { data, error: null };
    } catch (error) {
      if (error instanceof ZodError) {
        return {
          data: null as any,
          error: NextResponse.json(
            {
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Invalid query parameters',
                details: error.issues,
                timestamp: new Date().toISOString(),
                path: request.nextUrl.pathname,
              },
            },
            { status: 400 }
          ),
        };
      }
      throw error;
    }
  };
}

/**
 * Validation middleware wrapper
 */
export function withValidation<TBody = any, TQuery = any>(options: {
  body?: ZodSchema<TBody>;
  query?: ZodSchema<TQuery>;
}) {
  return (
    handler: (
      request: NextRequest,
      validated: { body?: TBody; query?: TQuery }
    ) => Promise<NextResponse>
  ) => {
    return async (request: NextRequest) => {
      try {
        const validated: { body?: TBody; query?: TQuery } = {};

        // Validate body if schema provided
        if (options.body) {
          const { data, error } = await validateBody(options.body)(request);
          if (error) return error;
          validated.body = data;
        }

        // Validate query if schema provided
        if (options.query) {
          const { data, error } = validateQuery(options.query)(request);
          if (error) return error;
          validated.query = data;
        }

        return await handler(request, validated);
      } catch (error) {
        return await handleApiError(error, request);
      }
    };
  };
}

