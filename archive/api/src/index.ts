/**
 * @quantbot/api - Backend API Package
 *
 * Provides REST API endpoints for:
 * - OHLCV data queries
 * - Token metadata and calls
 * - Simulation results
 * - Ingestion endpoints
 * - Health checks
 *
 * This API is consumed by:
 * - @quantbot/bot (Telegram bot)
 * - @quantbot/web (Web dashboard)
 * - @quantbot/trading (Trading execution)
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { logger } from '@quantbot/utils';
import { initClickHouse } from '@quantbot/storage';

// Import routes
import { registerOhlcvRoutes } from './routes/ohlcv';
import { registerTokenRoutes } from './routes/tokens';
import { registerCallRoutes } from './routes/calls';
import { registerSimulationRoutes } from './routes/simulations';
import { registerIngestionRoutes } from './routes/ingestion';
import { registerHealthRoutes } from './routes/health';

const PORT = parseInt(process.env.API_PORT || '3000', 10);
const HOST = process.env.API_HOST || '0.0.0.0';

export async function createServer() {
  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
    },
    requestIdLogLabel: 'reqId',
    requestIdHeader: 'x-request-id',
  });

  // Register plugins
  await server.register(cors, {
    origin: process.env.CORS_ORIGIN?.split(',') || true,
    credentials: true,
  });

  await server.register(helmet, {
    contentSecurityPolicy: false, // Allow API responses
  });

  await server.register(rateLimit, {
    max: 100, // requests
    timeWindow: '1 minute',
  });

  // Register Swagger/OpenAPI
  await server.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'QuantBot API',
        description:
          'Backend REST API for QuantBot - provides endpoints for OHLCV data, tokens, calls, simulations, and ingestion',
        version: '1.0.0',
      },
      servers: [
        {
          url: process.env.API_URL || 'http://localhost:3000',
          description: 'Development server',
        },
      ],
      tags: [
        { name: 'health', description: 'Health check endpoints' },
        { name: 'ohlcv', description: 'OHLCV candle data endpoints' },
        { name: 'tokens', description: 'Token metadata endpoints' },
        { name: 'calls', description: 'Token call history endpoints' },
        { name: 'simulations', description: 'Simulation run endpoints' },
        { name: 'ingestion', description: 'Data ingestion endpoints' },
      ],
    },
  });

  await server.register(swaggerUi, {
    routePrefix: '/api/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
    staticCSP: true,
    transformStaticCSP: (header) => header,
  });

  // Register routes
  await server.register(registerOhlcvRoutes, { prefix: '/api/v1/ohlcv' });
  await server.register(registerTokenRoutes, { prefix: '/api/v1/tokens' });
  await server.register(registerCallRoutes, { prefix: '/api/v1/calls' });
  await server.register(registerSimulationRoutes, { prefix: '/api/v1/simulations' });
  await server.register(registerIngestionRoutes, { prefix: '/api/v1/ingestion' });
  await server.register(registerHealthRoutes, { prefix: '/api/v1/health' });

  // Root endpoint
  server.get('/', async () => {
    return {
      name: '@quantbot/api',
      version: '1.0.0',
      status: 'running',
      endpoints: {
        ohlcv: '/api/v1/ohlcv',
        tokens: '/api/v1/tokens',
        calls: '/api/v1/calls',
        simulations: '/api/v1/simulations',
        ingestion: '/api/v1/ingestion',
        health: '/api/v1/health',
        docs: '/api/docs',
      },
    };
  });

  return server;
}

export async function startServer() {
  try {
    // Initialize storage
    await initClickHouse();
    logger.info('Storage initialized');

    // Create and start server
    const server = await createServer();

    await server.listen({ port: PORT, host: HOST });
    logger.info(`API server listening on ${HOST}:${PORT}`);

    return server;
  } catch (error) {
    logger.error('Failed to start API server', error as Error);
    process.exit(1);
  }
}

// Start server if this file is run directly
if (require.main === module) {
  startServer().catch((error) => {
    logger.error('Unhandled error starting server', error as Error);
    process.exit(1);
  });
}
