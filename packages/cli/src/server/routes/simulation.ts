/**
 * Simulation routes
 */

import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { runSimulation, createProductionContext } from '@quantbot/workflows';

const CreateSimulationRunSchema = z.object({
  strategyName: z.string(),
  callerName: z.string().optional(),
  from: z.string().datetime(),
  to: z.string().datetime(),
  options: z
    .object({
      dryRun: z.boolean().optional(),
      preWindowMinutes: z.number().int().positive().optional(),
      postWindowMinutes: z.number().int().positive().optional(),
    })
    .optional(),
});

const GetSimulationRunsQuerySchema = z.object({
  strategyName: z.string().optional(),
  callerName: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
});

export async function simulationRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/v1/simulation/runs
   * Create a new simulation run
   */
  fastify.post(
    '/runs',
    {
      schema: {
        description: 'Create a new simulation run',
        tags: ['simulation'],
        body: {
          type: 'object',
          required: ['strategyName', 'from', 'to'],
          properties: {
            strategyName: { type: 'string' },
            callerName: { type: 'string' },
            from: { type: 'string', format: 'date-time' },
            to: { type: 'string', format: 'date-time' },
            options: {
              type: 'object',
              properties: {
                dryRun: { type: 'boolean' },
                preWindowMinutes: { type: 'number' },
                postWindowMinutes: { type: 'number' },
              },
            },
          },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              runId: { type: 'string' },
              strategyName: { type: 'string' },
              totals: {
                type: 'object',
                properties: {
                  calls: { type: 'number' },
                  successful: { type: 'number' },
                  failed: { type: 'number' },
                  trades: { type: 'number' },
                },
              },
              pnl: {
                type: 'object',
                properties: {
                  min: { type: 'number' },
                  max: { type: 'number' },
                  mean: { type: 'number' },
                  median: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const body = CreateSimulationRunSchema.parse(request.body);
      const ctx = createProductionContext();

      const result = await runSimulation(
        {
          strategyName: body.strategyName,
          callerName: body.callerName,
          from: DateTime.fromISO(body.from),
          to: DateTime.fromISO(body.to),
          options: body.options,
        },
        ctx
      );

      reply.status(201).send({
        runId: result.runId,
        strategyName: body.strategyName,
        totals: result.totals,
        pnl: result.pnl,
      });
    }
  );

  /**
   * GET /api/v1/simulation/runs
   * List simulation runs
   */
  fastify.get(
    '/runs',
    {
      schema: {
        description: 'List simulation runs',
        tags: ['simulation'],
        querystring: {
          type: 'object',
          properties: {
            strategyName: { type: 'string' },
            callerName: { type: 'string' },
            from: { type: 'string', format: 'date-time' },
            to: { type: 'string', format: 'date-time' },
            limit: { type: 'number' },
            offset: { type: 'number' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              runs: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    runId: { type: 'string' },
                    strategyName: { type: 'string' },
                    callerName: { type: 'string' },
                    from: { type: 'string' },
                    to: { type: 'string' },
                    totals: { type: 'object' },
                    pnl: { type: 'object' },
                  },
                },
              },
              total: { type: 'number' },
              limit: { type: 'number' },
              offset: { type: 'number' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const query = GetSimulationRunsQuerySchema.parse(request.query);

      // TODO: Implement simulation run listing from DuckDB
      // For now, return empty list
      reply.status(200).send({
        runs: [],
        total: 0,
        limit: query.limit,
        offset: query.offset,
      });
    }
  );

  /**
   * GET /api/v1/simulation/runs/:runId
   * Get simulation run details
   */
  fastify.get(
    '/runs/:runId',
    {
      schema: {
        description: 'Get simulation run details',
        tags: ['simulation'],
        params: {
          type: 'object',
          properties: {
            runId: { type: 'string' },
          },
          required: ['runId'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              runId: { type: 'string' },
              strategyName: { type: 'string' },
              results: { type: 'array' },
            },
          },
          404: {
            type: 'object',
            properties: {
              error: { type: 'object' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { runId: _runId } = request.params as { runId: string };

      // TODO: Implement simulation run retrieval from DuckDB/ClickHouse
      reply.status(404).send({
        error: {
          message: 'Simulation run not found',
          code: 404,
        },
      });
    }
  );
}
