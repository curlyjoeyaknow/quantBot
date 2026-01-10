/**
 * OHLCV routes
 */

import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getOhlcvStats, createOhlcvStatsContext } from '@quantbot/workflows';

const GetOhlcvStatsQuerySchema = z.object({
  chain: z.string().optional(),
  interval: z.string().optional(),
  minCoverage: z.coerce.number().optional(),
});

export async function ohlcvRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/v1/ohlcv/stats
   * Get OHLCV statistics
   *
   * Query parameters:
   * - chain: Filter by chain (optional)
   * - interval: Filter by interval (optional)
   * - minCoverage: Minimum coverage percentage (optional)
   */
  fastify.get(
    '/stats',
    {
      schema: {
        description: 'Get OHLCV statistics',
        tags: ['ohlcv'],
        querystring: {
          type: 'object',
          properties: {
            chain: { type: 'string' },
            interval: { type: 'string' },
            minCoverage: { type: 'number' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              totalTokens: { type: 'number' },
              totalCandles: { type: 'number' },
              coverageByChain: { type: 'object' },
              coverageByInterval: { type: 'object' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const query = GetOhlcvStatsQuerySchema.parse(request.query);
      const ctx = await createOhlcvStatsContext();

      const result = await getOhlcvStats(
        {
          chain: query.chain as 'solana' | 'ethereum' | 'bsc' | 'base' | undefined,
          interval: query.interval as '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | undefined,
          mint: undefined,
        },
        ctx
      );

      reply.status(200).send(result);
    }
  );
}
