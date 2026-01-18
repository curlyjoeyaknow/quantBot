/**
 * Metrics routes (Prometheus)
 */

import { type FastifyInstance } from 'fastify';
import { getPrometheusMetrics } from '@quantbot/infra/observability';

export async function metricsRoutes(fastify: FastifyInstance) {
  /**
   * GET /metrics
   * Prometheus metrics endpoint
   */
  fastify.get(
    '/metrics',
    {
      schema: {
        description: 'Prometheus metrics endpoint',
        tags: ['metrics'],
        response: {
          200: {
            type: 'string',
            description: 'Prometheus metrics in text format',
          },
        },
      },
    },
    async (request, reply) => {
      const metrics = getPrometheusMetrics();
      const metricsText = await metrics.getMetrics();

      reply.type('text/plain').send(metricsText);
    }
  );
}
