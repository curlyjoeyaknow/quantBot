/**
 * Health check routes
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getStorageEngine } from '@quantbot/storage';
import { logger } from '@quantbot/utils';

export async function registerHealthRoutes(fastify: FastifyInstance) {
  // Basic health check
  fastify.get(
    '/',
    {
      schema: {
        description: 'Basic health check endpoint',
        tags: ['health'],
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string', example: 'ok' },
              timestamp: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
      };
    }
  );

  // Detailed health check with storage status
  fastify.get(
    '/detailed',
    {
      schema: {
        description: 'Detailed health check with storage and system metrics',
        tags: ['health'],
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string', example: 'ok' },
              timestamp: { type: 'string', format: 'date-time' },
              storage: {
                type: 'object',
                properties: {
                  cache: {
                    type: 'object',
                    properties: {
                      size: { type: 'number' },
                      maxSize: { type: 'number' },
                    },
                  },
                },
              },
              uptime: { type: 'number' },
              memory: {
                type: 'object',
                properties: {
                  used: { type: 'number' },
                  total: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const storageEngine = getStorageEngine();
      const cacheStats = storageEngine.getCacheStats();

      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        storage: {
          cache: {
            size: cacheStats.size,
            maxSize: cacheStats.maxSize,
          },
        },
        uptime: process.uptime(),
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        },
      };
    }
  );

  // Readiness check (for Kubernetes)
  fastify.get(
    '/ready',
    {
      schema: {
        description: 'Readiness check for Kubernetes - verifies storage is accessible',
        tags: ['health'],
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string', example: 'ready' },
              timestamp: { type: 'string', format: 'date-time' },
            },
          },
          503: {
            type: 'object',
            properties: {
              status: { type: 'string', example: 'not ready' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Check if storage is accessible
        const storageEngine = getStorageEngine();
        storageEngine.getCacheStats(); // This will throw if storage is not initialized

        return {
          status: 'ready',
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        logger.error('Readiness check failed', error as Error);
        reply.code(503);
        return {
          status: 'not ready',
          error: (error as Error).message,
        };
      }
    }
  );

  // Liveness check (for Kubernetes)
  fastify.get(
    '/live',
    {
      schema: {
        description: 'Liveness check for Kubernetes',
        tags: ['health'],
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string', example: 'alive' },
              timestamp: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      return {
        status: 'alive',
        timestamp: new Date().toISOString(),
      };
    }
  );
}
