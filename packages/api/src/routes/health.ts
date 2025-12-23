/**
 * Health check routes
 */

import { type FastifyInstance } from 'fastify';
import { performHealthCheck, simpleHealthCheck } from '@quantbot/observability';

export async function healthRoutes(fastify: FastifyInstance) {
  /**
   * GET /health
   * Health check endpoint
   */
  fastify.get('/health', async (request, reply) => {
    const health = await performHealthCheck();
    const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;

    reply.status(statusCode).send({
      status: health.status,
      timestamp: health.timestamp.toISOString(),
      checks: health.checks,
    });
  });

  /**
   * GET /health/ready
   * Readiness probe
   */
  fastify.get('/health/ready', async (request, reply) => {
    const health = await simpleHealthCheck();
    const ready = health.status === 'ok';

    reply.status(ready ? 200 : 503).send({
      ready,
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * GET /health/live
   * Liveness probe
   */
  fastify.get('/health/live', async (request, reply) => {
    reply.status(200).send({
      alive: true,
      timestamp: new Date().toISOString(),
    });
  });
}
