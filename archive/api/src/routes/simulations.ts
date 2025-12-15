/**
 * Simulation routes
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { SimulationResultsRepository, SimulationRunsRepository } from '@quantbot/storage';
import { logger } from '@quantbot/utils';
import { z } from 'zod';

const resultsRepo = new SimulationResultsRepository();
const runsRepo = new SimulationRunsRepository();

export async function registerSimulationRoutes(fastify: FastifyInstance) {
  // GET /api/v1/simulations/runs/:id
  fastify.get(
    '/runs/:id',
    {
      schema: {
        description: 'Get simulation run by ID',
        tags: ['simulations'],
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: {
              type: 'string',
              description: 'Simulation run ID',
              example: '1',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            description: 'Simulation run data',
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

        const run = await runsRepo.getRunById(params.id);

        if (!run) {
          reply.code(404);
          return { error: 'Simulation run not found' };
        }

        return run;
      } catch (error) {
        if (error instanceof z.ZodError) {
          reply.code(400);
          return { error: 'Invalid request parameters', details: error.errors };
        }
        logger.error('Error fetching simulation run', error as Error);
        reply.code(500);
        return { error: 'Internal server error' };
      }
    }
  );

  // GET /api/v1/simulations/runs
  fastify.get(
    '/runs',
    {
      schema: {
        description: 'List simulation runs with optional filters',
        tags: ['simulations'],
        querystring: {
          type: 'object',
          properties: {
            strategyId: {
              type: 'string',
              description: 'Filter by strategy ID',
              example: '1',
            },
            tokenId: {
              type: 'string',
              description: 'Filter by token ID',
              example: '1',
            },
            callerId: {
              type: 'string',
              description: 'Filter by caller ID',
              example: '1',
            },
            status: {
              type: 'string',
              enum: ['pending', 'running', 'completed', 'failed'],
              description: 'Filter by status',
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
              runs: { type: 'array' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const query = z
          .object({
            strategyId: z.string().transform(Number).pipe(z.number().int().positive()).optional(),
            tokenId: z.string().transform(Number).pipe(z.number().int().positive()).optional(),
            callerId: z.string().transform(Number).pipe(z.number().int().positive()).optional(),
            status: z.enum(['pending', 'running', 'completed', 'failed']).optional(),
            limit: z.string().transform(Number).pipe(z.number().int().positive()).optional(),
            offset: z.string().transform(Number).pipe(z.number().int().nonnegative()).optional(),
          })
          .parse(request.query);

        const runs = await runsRepo.listRuns({
          strategyId: query.strategyId,
          tokenId: query.tokenId,
          callerId: query.callerId,
          status: query.status,
          limit: query.limit,
          offset: query.offset,
        });

        return {
          count: runs.length,
          runs,
        };
      } catch (error) {
        if (error instanceof z.ZodError) {
          reply.code(400);
          return { error: 'Invalid request parameters', details: error.errors };
        }
        logger.error('Error listing simulation runs', error as Error);
        reply.code(500);
        return { error: 'Internal server error' };
      }
    }
  );

  // GET /api/v1/simulations/results/:runId
  fastify.get(
    '/results/:runId',
    {
      schema: {
        description: 'Get simulation results for a run',
        tags: ['simulations'],
        params: {
          type: 'object',
          required: ['runId'],
          properties: {
            runId: {
              type: 'string',
              description: 'Simulation run ID',
              example: '1',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            description: 'Simulation results',
          },
          501: {
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
            runId: z.string().transform(Number).pipe(z.number().int().positive()),
          })
          .parse(request.params);

        // TODO: Implement getResultsByRunId in repository
        reply.code(501);
        return { error: 'Not implemented yet' };
      } catch (error) {
        if (error instanceof z.ZodError) {
          reply.code(400);
          return { error: 'Invalid request parameters', details: error.errors };
        }
        logger.error('Error fetching simulation results', error as Error);
        reply.code(500);
        return { error: 'Internal server error' };
      }
    }
  );
}
