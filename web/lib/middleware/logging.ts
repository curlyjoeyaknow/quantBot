/**
 * Request/Response Logging Middleware
 * ===================================
 * Logs all requests and responses with metadata
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger, createLogger } from '../logging/logger';
import { getRequestId, withRequestIdContext } from './request-id';

/**
 * Create a request logger with request ID
 */
export function createRequestLogger(requestId: string, context?: Record<string, unknown>) {
  return createLogger({ requestId, ...context });
}

/**
 * Log request details
 */
function logRequest(request: NextRequest): void {
  const requestId = getRequestId(request);
  const requestLogger = createLogger({ requestId });

  requestLogger.info('Incoming request', {
    method: request.method,
    path: request.nextUrl.pathname,
    query: Object.fromEntries(request.nextUrl.searchParams),
    headers: {
      'user-agent': request.headers.get('user-agent'),
      'content-type': request.headers.get('content-type'),
    },
  });
}

/**
 * Log response details
 */
function logResponse(
  request: NextRequest,
  response: NextResponse,
  startTime: number
): void {
  const requestId = getRequestId(request);
  const requestLogger = createLogger({ requestId });
  const duration = Date.now() - startTime;

  requestLogger.info('Outgoing response', {
    method: request.method,
    path: request.nextUrl.pathname,
    status: response.status,
    duration: `${duration}ms`,
    headers: {
      'content-type': response.headers.get('content-type'),
      'content-length': response.headers.get('content-length'),
    },
  });
}

/**
 * Request/response logging middleware
 */
export function withLogging(
  handler: (request: NextRequest) => Promise<NextResponse>
) {
  return withRequestIdContext(async (request: NextRequest) => {
    const startTime = Date.now();
    
    // Log request
    logRequest(request);

    try {
      // Execute handler
      const response = await handler(request);

      // Log response
      logResponse(request, response, startTime);

      return response;
    } catch (error) {
      const requestId = getRequestId(request);
      const requestLogger = createLogger({ requestId });
      const duration = Date.now() - startTime;

      requestLogger.error('Request failed', error, {
        method: request.method,
        path: request.nextUrl.pathname,
        duration: `${duration}ms`,
      });

      throw error;
    }
  });
}

