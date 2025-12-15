/**
 * Authentication middleware
 *
 * TODO: Implement proper authentication when needed
 * For now, this is a placeholder that can be extended
 */

import { FastifyRequest, FastifyReply } from 'fastify';

export interface AuthenticatedRequest extends FastifyRequest {
  user?: {
    id: string;
    role?: string;
  };
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  // TODO: Implement authentication logic
  // For now, allow all requests (development mode)
  const apiKey = request.headers['x-api-key'];

  if (process.env.REQUIRE_AUTH === 'true' && !apiKey) {
    reply.code(401);
    return { error: 'Authentication required' };
  }

  // If API key is provided, validate it
  if (apiKey && process.env.API_KEY && apiKey !== process.env.API_KEY) {
    reply.code(401);
    return { error: 'Invalid API key' };
  }

  // Attach user info to request (if authenticated)
  (request as AuthenticatedRequest).user = {
    id: 'anonymous',
  };
}
