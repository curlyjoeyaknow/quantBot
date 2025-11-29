/**
 * Authentication Middleware
 * =========================
 * JWT-based authentication for API routes
 */

import { NextRequest, NextResponse } from 'next/server';
import { SignJWT, jwtVerify } from 'jose';

/**
 * JWT Secret - should be from environment variable
 */
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-me-in-production-minimum-32-characters-long'
);

/**
 * Token expiration time (default: 24 hours)
 */
const TOKEN_EXPIRATION = process.env.JWT_EXPIRATION || '24h';

/**
 * User roles
 */
export enum UserRole {
  ADMIN = 'admin',
  USER = 'user',
  READONLY = 'readonly',
}

/**
 * User session data
 */
export interface UserSession {
  userId: string;
  role: UserRole;
  email?: string;
  name?: string;
}

/**
 * Authentication error
 */
export class AuthenticationError extends Error {
  constructor(message: string = 'Authentication required') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/**
 * Authorization error
 */
export class AuthorizationError extends Error {
  constructor(message: string = 'Insufficient permissions') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

/**
 * Generate JWT token for a user
 */
export async function generateToken(session: UserSession): Promise<string> {
  const token = await new SignJWT(session as any)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRATION)
    .sign(JWT_SECRET);

  return token;
}

/**
 * Verify and decode JWT token
 */
export async function verifyToken(token: string): Promise<UserSession> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as UserSession;
  } catch (error) {
    throw new AuthenticationError('Invalid or expired token');
  }
}

/**
 * Extract token from Authorization header
 */
function extractToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
}

/**
 * Require authentication middleware
 * Returns the user session if authenticated, throws error otherwise
 */
export async function requireAuth(request: NextRequest): Promise<UserSession> {
  const token = extractToken(request);
  
  if (!token) {
    throw new AuthenticationError('Missing authentication token');
  }

  try {
    const session = await verifyToken(token);
    return session;
  } catch (error) {
    if (error instanceof AuthenticationError) {
      throw error;
    }
    throw new AuthenticationError('Authentication failed');
  }
}

/**
 * Require specific role middleware
 */
export async function requireRole(
  request: NextRequest,
  allowedRoles: UserRole[]
): Promise<UserSession> {
  const session = await requireAuth(request);

  if (!allowedRoles.includes(session.role)) {
    throw new AuthorizationError(
      `Access denied. Required roles: ${allowedRoles.join(', ')}`
    );
  }

  return session;
}

/**
 * Optional authentication - returns session if present, null otherwise
 */
export async function optionalAuth(request: NextRequest): Promise<UserSession | null> {
  try {
    return await requireAuth(request);
  } catch {
    return null;
  }
}

/**
 * Authentication middleware wrapper for Next.js API routes
 * Supports both regular routes and dynamic routes with params
 */
export function withAuth<T extends any[] = []>(
  handler: (request: NextRequest, session: UserSession, ...args: T) => Promise<NextResponse>
) {
  return async (request: NextRequest, ...args: T) => {
    try {
      const session = await requireAuth(request);
      return await handler(request, session, ...args);
    } catch (error) {
      if (error instanceof AuthenticationError || error instanceof AuthorizationError) {
        return NextResponse.json(
          {
            error: {
              code: error instanceof AuthenticationError ? 'UNAUTHORIZED' : 'FORBIDDEN',
              message: error.message,
            },
          },
          { status: error instanceof AuthenticationError ? 401 : 403 }
        );
      }
      throw error;
    }
  };
}

/**
 * Role-based authentication middleware wrapper
 * Supports both regular routes and dynamic routes with params
 */
export function withRole<T extends any[] = []>(
  allowedRoles: UserRole[],
  handler: (request: NextRequest, session: UserSession, ...args: T) => Promise<NextResponse>
) {
  return async (request: NextRequest, ...args: T) => {
    try {
      const session = await requireRole(request, allowedRoles);
      return await handler(request, session, ...args);
    } catch (error) {
      if (error instanceof AuthenticationError || error instanceof AuthorizationError) {
        return NextResponse.json(
          {
            error: {
              code: error instanceof AuthenticationError ? 'UNAUTHORIZED' : 'FORBIDDEN',
              message: error.message,
            },
          },
          { status: error instanceof AuthenticationError ? 401 : 403 }
        );
      }
      throw error;
    }
  };
}

