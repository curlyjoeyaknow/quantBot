/**
 * CORS Middleware
 * ===============
 * Handles Cross-Origin Resource Sharing
 */

import { NextRequest, NextResponse } from 'next/server';

/**
 * Allowed origins from environment variable
 */
const getAllowedOrigins = (): string[] => {
  const origins = process.env.ALLOWED_ORIGINS;
  if (!origins) {
    return ['http://localhost:3000', 'http://localhost:3001'];
  }
  return origins.split(',').map(o => o.trim());
};

/**
 * CORS headers
 */
export function corsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get('origin');
  const allowedOrigins = getAllowedOrigins();
  
  // Check if origin is allowed
  const isAllowed = !origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*');
  const allowOrigin = isAllowed ? (origin || '*') : 'null';

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400', // 24 hours
  };
}

/**
 * Handle OPTIONS preflight request
 */
export function handleCorsPreflight(request: NextRequest): NextResponse | null {
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders(request),
    });
  }
  return null;
}

/**
 * CORS middleware wrapper
 */
export function withCors(
  handler: (request: NextRequest) => Promise<NextResponse>
) {
  return async (request: NextRequest) => {
    // Handle preflight
    const preflight = handleCorsPreflight(request);
    if (preflight) {
      return preflight;
    }

    // Execute handler
    const response = await handler(request);

    // Add CORS headers to response
    const headers = corsHeaders(request);
    for (const [key, value] of Object.entries(headers)) {
      response.headers.set(key, value);
    }

    return response;
  };
}

