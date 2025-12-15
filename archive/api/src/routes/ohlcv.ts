/**
 * OHLCV data routes
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { DateTime } from 'luxon';
import { getStorageEngine } from '@quantbot/storage';
import { logger } from '@quantbot/utils';
import { z } from 'zod';

// Request schemas
const getCandlesSchema = z.object({
  tokenAddress: z.string().min(1),
  chain: z.string().default('solana'),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  interval: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']).default('5m'),
});

export async function registerOhlcvRoutes(fastify: FastifyInstance) {
  const storageEngine = getStorageEngine();

  // GET /api/v1/ohlcv/candles
  fastify.get(
    '/candles',
    {
      schema: {
        description: 'Fetch OHLCV candles for a token',
        tags: ['ohlcv'],
        querystring: {
          type: 'object',
          required: ['tokenAddress', 'startTime', 'endTime'],
          properties: {
            tokenAddress: {
              type: 'string',
              description: 'Token address (mint address)',
              example: '7pXs123456789012345678901234567890pump',
            },
            chain: {
              type: 'string',
              description: 'Blockchain network',
              default: 'solana',
              example: 'solana',
            },
            startTime: {
              type: 'string',
              format: 'date-time',
              description: 'Start time in ISO 8601 format',
              example: '2024-01-01T00:00:00Z',
            },
            endTime: {
              type: 'string',
              format: 'date-time',
              description: 'End time in ISO 8601 format',
              example: '2024-01-02T00:00:00Z',
            },
            interval: {
              type: 'string',
              enum: ['1m', '5m', '15m', '1h', '4h', '1d'],
              default: '5m',
              description: 'Candle interval',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            description: 'OHLCV candles response',
            properties: {
              tokenAddress: { type: 'string' },
              chain: { type: 'string' },
              interval: { type: 'string' },
              startTime: { type: 'string' },
              endTime: { type: 'string' },
              count: { type: 'number' },
              candles: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    timestamp: { type: 'number' },
                    open: { type: 'number' },
                    high: { type: 'number' },
                    low: { type: 'number' },
                    close: { type: 'number' },
                    volume: { type: 'number' },
                  },
                },
              },
            },
          },
          400: {
            type: 'object',
            properties: {
              error: { type: 'string' },
              details: { type: 'array' },
            },
          },
          500: {
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const query = getCandlesSchema.parse(request.query);

        const startTime = DateTime.fromISO(query.startTime);
        const endTime = DateTime.fromISO(query.endTime);

        const candles = await storageEngine.getCandles(
          query.tokenAddress,
          query.chain,
          startTime,
          endTime,
          { interval: query.interval }
        );

        return {
          tokenAddress: query.tokenAddress,
          chain: query.chain,
          interval: query.interval,
          startTime: query.startTime,
          endTime: query.endTime,
          count: candles.length,
          candles,
        };
      } catch (error) {
        if (error instanceof z.ZodError) {
          reply.code(400);
          return { error: 'Invalid request parameters', details: error.errors };
        }
        logger.error('Error fetching candles', error as Error);
        reply.code(500);
        return { error: 'Internal server error' };
      }
    }
  );

  // GET /api/v1/ohlcv/candles/multi-interval
  fastify.get(
    '/candles/multi-interval',
    {
      schema: {
        description: 'Fetch OHLCV candles for multiple intervals',
        tags: ['ohlcv'],
        querystring: {
          type: 'object',
          required: ['tokenAddress', 'startTime', 'endTime', 'intervals'],
          properties: {
            tokenAddress: {
              type: 'string',
              description: 'Token address (mint address)',
              example: '7pXs123456789012345678901234567890pump',
            },
            chain: {
              type: 'string',
              description: 'Blockchain network',
              default: 'solana',
              example: 'solana',
            },
            startTime: {
              type: 'string',
              format: 'date-time',
              description: 'Start time in ISO 8601 format',
              example: '2024-01-01T00:00:00Z',
            },
            endTime: {
              type: 'string',
              format: 'date-time',
              description: 'End time in ISO 8601 format',
              example: '2024-01-02T00:00:00Z',
            },
            intervals: {
              type: 'string',
              description: 'Comma-separated list of intervals (e.g., "1m,5m,1h")',
              example: '1m,5m,1h',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            description: 'Multi-interval OHLCV candles response',
            properties: {
              tokenAddress: { type: 'string' },
              chain: { type: 'string' },
              startTime: { type: 'string' },
              endTime: { type: 'string' },
              intervals: { type: 'array', items: { type: 'string' } },
              candles: {
                type: 'object',
                additionalProperties: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      timestamp: { type: 'number' },
                      open: { type: 'number' },
                      high: { type: 'number' },
                      low: { type: 'number' },
                      close: { type: 'number' },
                      volume: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
          400: {
            type: 'object',
            properties: {
              error: { type: 'string' },
              details: { type: 'array' },
            },
          },
          500: {
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const query = z
          .object({
            tokenAddress: z.string().min(1),
            chain: z.string().default('solana'),
            startTime: z.string().datetime(),
            endTime: z.string().datetime(),
            intervals: z
              .string()
              .transform((s) => s.split(','))
              .pipe(z.array(z.enum(['1m', '5m', '15m', '1h', '4h', '1d']))),
          })
          .parse(request.query);

        const startTime = DateTime.fromISO(query.startTime);
        const endTime = DateTime.fromISO(query.endTime);

        const candlesMap = await storageEngine.getCandlesMultiInterval(
          query.tokenAddress,
          query.chain,
          startTime,
          endTime,
          query.intervals
        );

        const result: Record<string, any[]> = {};
        candlesMap.forEach((candles, interval) => {
          result[interval] = candles;
        });

        return {
          tokenAddress: query.tokenAddress,
          chain: query.chain,
          startTime: query.startTime,
          endTime: query.endTime,
          intervals: query.intervals,
          candles: result,
        };
      } catch (error) {
        if (error instanceof z.ZodError) {
          reply.code(400);
          return { error: 'Invalid request parameters', details: error.errors };
        }
        logger.error('Error fetching multi-interval candles', error as Error);
        reply.code(500);
        return { error: 'Internal server error' };
      }
    }
  );
}
