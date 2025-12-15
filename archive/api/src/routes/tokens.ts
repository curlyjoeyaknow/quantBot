/**
 * Token routes
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { TokensRepository } from '@quantbot/storage';
import { logger } from '@quantbot/utils';
import { z } from 'zod';

const tokensRepo = new TokensRepository();

export async function registerTokenRoutes(fastify: FastifyInstance) {
  // GET /api/v1/tokens/:chain/:address
  fastify.get(
    '/:chain/:address',
    {
      schema: {
        description: 'Get token metadata by chain and address',
        tags: ['tokens'],
        params: {
          type: 'object',
          required: ['chain', 'address'],
          properties: {
            chain: {
              type: 'string',
              description: 'Blockchain network',
              example: 'solana',
            },
            address: {
              type: 'string',
              description: 'Token address (mint address)',
              example: '7pXs123456789012345678901234567890pump',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            description: 'Token metadata',
            properties: {
              id: { type: 'number' },
              chain: { type: 'string' },
              address: { type: 'string' },
              symbol: { type: 'string', nullable: true },
              name: { type: 'string', nullable: true },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
          404: {
            type: 'object',
            properties: {
              error: { type: 'string' },
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
        const params = z
          .object({
            chain: z.string(),
            address: z.string().min(1),
          })
          .parse(request.params);

        const token = await tokensRepo.getTokenByAddress(params.chain, params.address);

        if (!token) {
          reply.code(404);
          return { error: 'Token not found' };
        }

        return token;
      } catch (error) {
        if (error instanceof z.ZodError) {
          reply.code(400);
          return { error: 'Invalid request parameters', details: error.errors };
        }
        logger.error('Error fetching token', error as Error);
        reply.code(500);
        return { error: 'Internal server error' };
      }
    }
  );

  // GET /api/v1/tokens
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = z
        .object({
          chain: z.string().optional(),
          limit: z.string().transform(Number).pipe(z.number().int().positive()).optional(),
          offset: z.string().transform(Number).pipe(z.number().int().nonnegative()).optional(),
        })
        .parse(request.query);

      // TODO: Implement list tokens endpoint in repository
      reply.code(501);
      return { error: 'Not implemented yet' };
    } catch (error) {
      if (error instanceof z.ZodError) {
        reply.code(400);
        return { error: 'Invalid request parameters', details: error.errors };
      }
      logger.error('Error listing tokens', error as Error);
      reply.code(500);
      return { error: 'Internal server error' };
    }
  });
}
