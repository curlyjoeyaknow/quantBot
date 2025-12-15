/**
 * Ingestion routes
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { DateTime } from 'luxon';
import { getStorageEngine } from '@quantbot/storage';
import { getOhlcvIngestionEngine } from '@quantbot/ohlcv';
import { logger } from '@quantbot/utils';
import { z } from 'zod';

export async function registerIngestionRoutes(fastify: FastifyInstance) {
  const storageEngine = getStorageEngine();
  const ingestionEngine = getOhlcvIngestionEngine();

  // POST /api/v1/ingestion/candles
  fastify.post(
    '/candles',
    {
      schema: {
        description: 'Trigger OHLCV candle ingestion for a token',
        tags: ['ingestion'],
        body: {
          type: 'object',
          required: ['tokenAddress', 'alertTime'],
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
            alertTime: {
              type: 'string',
              format: 'date-time',
              description: 'Alert time in ISO 8601 format',
              example: '2024-01-01T10:30:00Z',
            },
            options: {
              type: 'object',
              properties: {
                useCache: {
                  type: 'boolean',
                  description: 'Use cache if available',
                  default: true,
                },
                forceRefresh: {
                  type: 'boolean',
                  description: 'Force refresh from API',
                  default: false,
                },
              },
            },
          },
        },
        response: {
          200: {
            type: 'object',
            description: 'Ingestion result',
            properties: {
              tokenAddress: { type: 'string' },
              chain: { type: 'string' },
              alertTime: { type: 'string' },
              result: { type: 'object' },
            },
          },
          400: {
            type: 'object',
            properties: {
              error: { type: 'string' },
              details: { type: 'array' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = z
          .object({
            tokenAddress: z.string().min(1),
            chain: z.string().default('solana'),
            alertTime: z.string().datetime(),
            options: z
              .object({
                useCache: z.boolean().default(true),
                forceRefresh: z.boolean().default(false),
              })
              .optional(),
          })
          .parse(request.body);

        const alertTime = DateTime.fromISO(body.alertTime);

        const result = await ingestionEngine.fetchCandles(
          body.tokenAddress,
          body.chain as any,
          alertTime,
          body.options
        );

        return {
          tokenAddress: body.tokenAddress,
          chain: body.chain,
          alertTime: body.alertTime,
          result,
        };
      } catch (error) {
        if (error instanceof z.ZodError) {
          reply.code(400);
          return { error: 'Invalid request body', details: error.errors };
        }
        logger.error('Error ingesting candles', error as Error);
        reply.code(500);
        return { error: 'Internal server error' };
      }
    }
  );

  // POST /api/v1/ingestion/candles/batch
  fastify.post(
    '/candles/batch',
    {
      schema: {
        description: 'Batch ingest OHLCV candles for multiple tokens',
        tags: ['ingestion'],
        body: {
          type: 'object',
          required: ['tokens'],
          properties: {
            tokens: {
              type: 'array',
              description: 'Array of tokens to ingest',
              items: {
                type: 'object',
                required: ['tokenAddress', 'alertTime'],
                properties: {
                  tokenAddress: {
                    type: 'string',
                    description: 'Token address (mint address)',
                  },
                  chain: {
                    type: 'string',
                    description: 'Blockchain network',
                    default: 'solana',
                  },
                  alertTime: {
                    type: 'string',
                    format: 'date-time',
                    description: 'Alert time in ISO 8601 format',
                  },
                },
              },
            },
            options: {
              type: 'object',
              properties: {
                useCache: { type: 'boolean', default: true },
                forceRefresh: { type: 'boolean', default: false },
              },
            },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              total: { type: 'number' },
              successful: { type: 'number' },
              failed: { type: 'number' },
              results: { type: 'array' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = z
          .object({
            tokens: z.array(
              z.object({
                tokenAddress: z.string().min(1),
                chain: z.string().default('solana'),
                alertTime: z.string().datetime(),
              })
            ),
            options: z
              .object({
                useCache: z.boolean().default(true),
                forceRefresh: z.boolean().default(false),
              })
              .optional(),
          })
          .parse(request.body);

        const results = await Promise.allSettled(
          body.tokens.map(async (token) => {
            const alertTime = DateTime.fromISO(token.alertTime);
            return {
              tokenAddress: token.tokenAddress,
              chain: token.chain,
              result: await ingestionEngine.fetchCandles(
                token.tokenAddress,
                token.chain as any,
                alertTime,
                body.options
              ),
            };
          })
        );

        return {
          total: body.tokens.length,
          successful: results.filter((r) => r.status === 'fulfilled').length,
          failed: results.filter((r) => r.status === 'rejected').length,
          results: results.map((r, i) => ({
            token: body.tokens[i],
            status: r.status,
            value: r.status === 'fulfilled' ? r.value : undefined,
            error: r.status === 'rejected' ? (r.reason as Error).message : undefined,
          })),
        };
      } catch (error) {
        if (error instanceof z.ZodError) {
          reply.code(400);
          return { error: 'Invalid request body', details: error.errors };
        }
        logger.error('Error batch ingesting candles', error as Error);
        reply.code(500);
        return { error: 'Internal server error' };
      }
    }
  );
}
