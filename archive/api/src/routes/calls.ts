/**
 * Call routes (caller alerts)
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { CallsRepository, CallersRepository } from '@quantbot/storage';
import { logger } from '@quantbot/utils';
import { z } from 'zod';

const callsRepo = new CallsRepository();
const callersRepo = new CallersRepository();

export async function registerCallRoutes(fastify: FastifyInstance) {
  // GET /api/v1/calls/:id
  fastify.get(
    '/:id',
    {
      schema: {
        description: 'Get call by ID',
        tags: ['calls'],
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: {
              type: 'string',
              description: 'Call ID',
              example: '1',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            description: 'Call data',
          },
          404: {
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
            id: z.string().transform(Number).pipe(z.number().int().positive()),
          })
          .parse(request.params);

        const call = await callsRepo.getCallById(params.id);

        if (!call) {
          reply.code(404);
          return { error: 'Call not found' };
        }

        return call;
      } catch (error) {
        if (error instanceof z.ZodError) {
          reply.code(400);
          return { error: 'Invalid request parameters', details: error.errors };
        }
        logger.error('Error fetching call', error as Error);
        reply.code(500);
        return { error: 'Internal server error' };
      }
    }
  );

  // GET /api/v1/calls
  fastify.get(
    '/',
    {
      schema: {
        description: 'List calls with optional filters',
        tags: ['calls'],
        querystring: {
          type: 'object',
          properties: {
            callerId: {
              type: 'string',
              description: 'Filter by caller ID',
              example: '1',
            },
            tokenId: {
              type: 'string',
              description: 'Filter by token ID',
              example: '1',
            },
            limit: {
              type: 'string',
              description: 'Maximum number of results',
              example: '100',
            },
            offset: {
              type: 'string',
              description: 'Offset for pagination',
              example: '0',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              count: { type: 'number' },
              calls: { type: 'array' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const query = z
          .object({
            callerId: z.string().transform(Number).pipe(z.number().int().positive()).optional(),
            tokenId: z.string().transform(Number).pipe(z.number().int().positive()).optional(),
            limit: z.string().transform(Number).pipe(z.number().int().positive()).optional(),
            offset: z.string().transform(Number).pipe(z.number().int().nonnegative()).optional(),
          })
          .parse(request.query);

        const calls = await callsRepo.listCalls({
          callerId: query.callerId,
          tokenId: query.tokenId,
          limit: query.limit,
          offset: query.offset,
        });

        return {
          count: calls.length,
          calls,
        };
      } catch (error) {
        if (error instanceof z.ZodError) {
          reply.code(400);
          return { error: 'Invalid request parameters', details: error.errors };
        }
        logger.error('Error listing calls', error as Error);
        reply.code(500);
        return { error: 'Internal server error' };
      }
    }
  );

  // GET /api/v1/calls/callers
  fastify.get(
    '/callers',
    {
      schema: {
        description: 'List all callers',
        tags: ['calls'],
        response: {
          200: {
            type: 'object',
            properties: {
              count: { type: 'number' },
              callers: { type: 'array' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const callers = await callersRepo.listCallers();
        return {
          count: callers.length,
          callers,
        };
      } catch (error) {
        logger.error('Error listing callers', error as Error);
        reply.code(500);
        return { error: 'Internal server error' };
      }
    }
  );
}
