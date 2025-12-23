/**
 * Fastify API Server
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { logger } from '@quantbot/utils';
import { healthRoutes } from './routes/health.js';
import { ohlcvRoutes } from './routes/ohlcv.js';
import { simulationRoutes } from './routes/simulation.js';
import { metricsRoutes } from './routes/metrics.js';

export interface ApiServerConfig {
  port?: number;
  host?: string;
  enableSwagger?: boolean;
  corsOrigin?: string | string[];
}

/**
 * Create and configure Fastify API server
 */
export async function createApiServer(config: ApiServerConfig = {}): Promise<FastifyInstance> {
  const {
    port = Number(process.env.PORT) || 3000,
    host = process.env.HOST || '0.0.0.0',
    enableSwagger = process.env.NODE_ENV !== 'production',
    corsOrigin = '*',
  } = config;

  const server = Fastify({
    logger: process.env.NODE_ENV === 'development',
  });

  // CORS
  await server.register(cors, {
    origin: corsOrigin,
  });

  // Swagger/OpenAPI documentation
  if (enableSwagger) {
    await server.register(swagger, {
      openapi: {
        info: {
          title: 'QuantBot API',
          description: 'REST API for QuantBot analytics and simulation',
          version: '1.0.0',
        },
        servers: [
          {
            url: `http://${host}:${port}`,
            description: 'Development server',
          },
        ],
      },
    });

    await server.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: false,
      },
    });
  }

  // Health check
  await server.register(healthRoutes);

  // Metrics (Prometheus)
  await server.register(metricsRoutes);

  // API routes
  await server.register(async (fastify) => {
    await fastify.register(ohlcvRoutes, { prefix: '/api/v1/ohlcv' });
    await fastify.register(simulationRoutes, { prefix: '/api/v1/simulation' });
  });

  // Error handler
  server.setErrorHandler((error, request, reply) => {
    logger.error('API error', error as Error, {
      method: request.method,
      url: request.url,
    });

    reply.status(error.statusCode || 500).send({
      error: {
        message: error.message || 'Internal server error',
        code: error.statusCode || 500,
      },
    });
  });

  // Start server
  const start = async () => {
    try {
      await server.listen({ port, host });
      logger.info('API server started', { port, host, docs: enableSwagger ? `/docs` : undefined });
    } catch (error) {
      logger.error('Failed to start API server', error as Error);
      process.exit(1);
    }
  };

  // Expose start method
  (server as any).start = start;

  return server;
}
