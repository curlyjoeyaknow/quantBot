/**
 * Request ID Middleware
 * =====================
 * Generates unique request IDs for tracking
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

const REQUEST_ID_HEADER = 'X-Request-ID';

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Get or generate request ID from request
 */
export function getRequestId(request: NextRequest): string {
  const existing = request.headers.get(REQUEST_ID_HEADER);
  if (existing) {
    return existing;
  }
  return generateRequestId();
}

/**
 * Request ID middleware - adds request ID to all requests and responses
 */
export function withRequestId(
  handler: (request: NextRequest) => Promise<NextResponse>
) {
  return async (request: NextRequest) => {
    const requestId = getRequestId(request);
    
    // Execute handler
    const response = await handler(request);
    
    // Add request ID to response headers
    response.headers.set(REQUEST_ID_HEADER, requestId);
    
    return response;
  };
}

/**
 * Store request ID in AsyncLocalStorage for logging
 */
import { AsyncLocalStorage } from 'async_hooks';

export const requestIdStorage = new AsyncLocalStorage<string>();

/**
 * Get current request ID from context
 */
export function getCurrentRequestId(): string | undefined {
  return requestIdStorage.getStore();
}

/**
 * Request ID middleware with context storage
 */
export function withRequestIdContext(
  handler: (request: NextRequest) => Promise<NextResponse>
) {
  return async (request: NextRequest) => {
    const requestId = getRequestId(request);
    
    return requestIdStorage.run(requestId, async () => {
      const response = await handler(request);
      response.headers.set(REQUEST_ID_HEADER, requestId);
      return response;
    });
  };
}

