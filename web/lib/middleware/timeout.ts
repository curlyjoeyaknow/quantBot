/**
 * Timeout Middleware
 * ==================
 * Request timeout configuration
 */

import { NextRequest, NextResponse } from 'next/server';
import { TimeoutError } from '../errors/api-errors';

export const TIMEOUTS = {
  SHORT: 5 * 1000,      // 5 seconds
  STANDARD: 30 * 1000,  // 30 seconds
  LONG: 60 * 1000,      // 60 seconds
  VERY_LONG: 120 * 1000, // 2 minutes
};

/**
 * Timeout middleware wrapper for route handlers
 */
export function withTimeout(
  handler: (request: NextRequest) => Promise<NextResponse>,
  timeoutMs: number = TIMEOUTS.STANDARD
) {
  return async (request: NextRequest) => {
    return Promise.race([
      handler(request),
      new Promise<NextResponse>((_, reject) =>
        setTimeout(() => reject(new TimeoutError('Request timeout', timeoutMs)), timeoutMs)
      ),
    ]);
  };
}

/**
 * Timeout wrapper for promises (non-route handlers)
 */
export function withTimeoutPromise<T>(
  promise: Promise<T>,
  timeoutMs: number = TIMEOUTS.STANDARD
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new TimeoutError('Operation timeout', timeoutMs)), timeoutMs)
    ),
  ]);
}
