/**
 * Token Statistics Workflow
 *
 * Combines data from DuckDB (calls) and ClickHouse (OHLCV, simulations)
 * to provide comprehensive token statistics.
 */

import { z } from 'zod';

import { DateTime } from 'luxon';
import { resolve } from 'path';
import type { WorkflowContextWithPorts } from '../context/workflowContextWithPorts.js';
import { ConfigurationError } from '@quantbot/utils';

/**
 * Token stats spec
 */
export const GetTokenStatsSpecSchema = z.object({
  from: z.string().optional(), // ISO date string
  to: z.string().optional(), // ISO date string
  chain: z.enum(['solana', 'ethereum', 'bsc', 'base']).optional(),
  duckdbPath: z.string().optional(),
  limit: z.number().int().positive().optional(),
});

export type GetTokenStatsSpec = z.infer<typeof GetTokenStatsSpecSchema>;

/**
 * Token stats result
 */
export type GetTokenStatsResult = {
  timestamp: string; // ISO string
  totalTokens: number;
  totalCalls: number;
  tokens: Array<{
    mint: string;
    chain: string;
    ticker?: string;
    firstCallTime: string; // ISO string
    lastCallTime: string; // ISO string
    callCount: number;
    ohlcvEnriched: boolean;
    totalCandles: number;
    timeframes: string[]; // e.g., ['1m', '5m', '15s', '1H']
    simulationsRun: number;
    dateRange?: {
      earliest: string; // ISO string
      latest: string; // ISO string
    };
  }>;
  summary: {
    tokensWithOhlcv: number;
    tokensWithoutOhlcv: number;
    totalCandles: number;
    totalSimulations: number;
  };
};

/**
 * Extended context for token stats
 * Uses ports for all external dependencies
 */
export type TokenStatsContext = WorkflowContextWithPorts & {
  logger: {
    info: (message: string, context?: unknown) => void;
    warn: (message: string, context?: unknown) => void;
    error: (message: string, context?: unknown) => void;
    debug?: (message: string, context?: unknown) => void;
  };
  clock: {
    nowISO: () => string;
  };
  duckdb: {
    path: string;
  };
};

/**
 * Create default context (for testing)
 */
export function createDefaultTokenStatsContext(): TokenStatsContext {
  throw new ConfigurationError(
    'createDefaultTokenStatsContext must be implemented with actual services',
    'TokenStatsContext'
  );
}

/**
 * Get token statistics workflow
 */
export async function getTokenStats(
  spec: GetTokenStatsSpec,
  ctx: TokenStatsContext = createDefaultTokenStatsContext()
): Promise<GetTokenStatsResult> {
  const validated = GetTokenStatsSpecSchema.parse(spec);
  const timestamp = ctx.clock.nowISO();
  const database = process.env.CLICKHOUSE_DATABASE || 'quantbot';
  const duckdbPathRaw = validated.duckdbPath || ctx.duckdb?.path || process.env.DUCKDB_PATH;

  if (!duckdbPathRaw) {
    throw new ConfigurationError(
      'DuckDB path is required. Provide duckdbPath in spec or set DUCKDB_PATH environment variable.',
      'duckdbPath',
      { spec: validated, env: { DUCKDB_PATH: process.env.DUCKDB_PATH } }
    );
  }

  // Resolve relative paths to absolute paths
  const duckdbPath = duckdbPathRaw.startsWith('/')
    ? duckdbPathRaw
    : resolve(process.cwd(), duckdbPathRaw);

  // 1. Query DuckDB for token calls
  const { getDuckDBWorklistService } = await import('@quantbot/storage');
  const worklistService = getDuckDBWorklistService();
  const worklistResult = await worklistService.queryWorklist({
    duckdbPath,
    from: validated.from,
    to: validated.to,
    side: 'buy',
  });

  const tokenGroups = worklistResult.tokenGroups;
  const calls = worklistResult.calls;

  // Limit if specified
  const limitedGroups = validated.limit ? tokenGroups.slice(0, validated.limit) : tokenGroups;

  // 2. For each token, check OHLCV and simulation data in ClickHouse
  const tokenStats: GetTokenStatsResult['tokens'] = [];
  let totalCandles = 0;
  let totalSimulations = 0;
  let tokensWithOhlcv = 0;
  let tokensWithoutOhlcv = 0;

  for (const group of limitedGroups) {
    const mint = group.mint;
    const chain = group.chain || 'solana';
    const earliestAlertTime = group.earliestAlertTime;
    const callCount = group.callCount || 0;

    // Skip if chain filter doesn't match
    if (validated.chain && chain !== validated.chain) {
      continue;
    }

    // Skip if no alert time
    if (!earliestAlertTime) {
      continue;
    }

    // Convert timestamp to DateTime
    const firstCallTime = DateTime.fromISO(earliestAlertTime);

    // Find last call time for this token
    const tokenCalls = calls.filter(
      (c: { mint: string; chain: string }) => c.mint === mint && c.chain === chain
    );
    const lastCallTime =
      tokenCalls.length > 0 && tokenCalls[tokenCalls.length - 1]?.alertTime !== null
        ? DateTime.fromISO(tokenCalls[tokenCalls.length - 1]!.alertTime!)
        : firstCallTime;

    // Check OHLCV data availability (check for candles around alert time ± 24h)
    const alertTime = firstCallTime;
    const ohlcvStart = alertTime.minus({ hours: 24 });
    const ohlcvEnd = alertTime.plus({ hours: 24 });

    // Query ClickHouse for candle counts per timeframe
    const escapedMint = mint.replace(/'/g, "''");
    const escapedChain = chain.replace(/'/g, "''");
    const startUnix = Math.floor(ohlcvStart.toSeconds());
    const endUnix = Math.floor(ohlcvEnd.toSeconds());

    // Check for candles in each timeframe
    const timeframes: string[] = [];
    let tokenCandleCount = 0;

    const intervals = ['1m', '5m', '15s', '1H'];
    for (const interval of intervals) {
      try {
        const intervalResult = await ctx.ports.query.query({
          query: `
          SELECT COUNT(*) as count
          FROM ${database}.ohlcv_candles
          WHERE (token_address = '${escapedMint}'
                 OR lower(token_address) = lower('${escapedMint}')
                 OR token_address LIKE '${escapedMint}%'
                 OR lower(token_address) LIKE lower('${escapedMint}%'))
            AND chain = '${escapedChain}'
            AND \`interval\` = '${interval}'
            AND timestamp >= toDateTime(${startUnix})
            AND timestamp <= toDateTime(${endUnix})
        `,
          format: 'JSONEachRow',
        });

        const count = parseInt(
          String((intervalResult.rows[0] as Record<string, unknown>)?.['count'] || 0),
          10
        );
        if (count > 0) {
          timeframes.push(interval);
          tokenCandleCount += count;
        }
      } catch (error) {
        // Skip this interval if query fails
        if (ctx.logger.debug) {
          ctx.logger.debug('Failed to query interval', {
            mint,
            interval,
            error: (error as Error).message,
          });
        }
      }
    }

    // Get total candles for this token (all timeframes, all time)
    let totalTokenCandles = 0;
    try {
      const totalResult = await ctx.ports.query.query({
        query: `
        SELECT COUNT(*) as count
        FROM ${database}.ohlcv_candles
        WHERE (token_address = '${escapedMint}'
               OR lower(token_address) = lower('${escapedMint}')
               OR token_address LIKE '${escapedMint}%'
               OR lower(token_address) LIKE lower('${escapedMint}%'))
          AND chain = '${escapedChain}'
      `,
        format: 'JSONEachRow',
      });
      totalTokenCandles = parseInt(
        String((totalResult.rows[0] as Record<string, unknown>)?.['count'] || 0),
        10
      );
    } catch (error) {
      if (ctx.logger.debug) {
        ctx.logger.debug('Failed to query total candles', {
          mint,
          error: (error as Error).message,
        });
      }
    }

    // Get date range for candles
    let dateRange: { earliest: string; latest: string } | undefined;
    try {
      const rangeResult = await ctx.ports.query.query({
        query: `
        SELECT MIN(timestamp) as min, MAX(timestamp) as max
        FROM ${database}.ohlcv_candles
        WHERE (token_address = '${escapedMint}'
               OR lower(token_address) = lower('${escapedMint}')
               OR token_address LIKE '${escapedMint}%'
               OR lower(token_address) LIKE lower('${escapedMint}%'))
          AND chain = '${escapedChain}'
      `,
        format: 'JSONEachRow',
      });
      const minTs = (rangeResult.rows[0] as Record<string, unknown>)?.['min'];
      const maxTs = (rangeResult.rows[0] as Record<string, unknown>)?.['max'];
      if (minTs && maxTs) {
        const earliest =
          typeof minTs === 'string' ? minTs : DateTime.fromSeconds(minTs as number).toISO()!;
        const latest =
          typeof maxTs === 'string' ? maxTs : DateTime.fromSeconds(maxTs as number).toISO()!;
        dateRange = { earliest, latest };
      }
    } catch (error) {
      if (ctx.logger.debug) {
        ctx.logger.debug('Failed to query date range', { mint, error: (error as Error).message });
      }
    }

    // Check simulation runs for this token
    let simulationsRun = 0;
    try {
      const simResult = await ctx.ports.query.query({
        query: `
        SELECT COUNT(DISTINCT run_id) as count
        FROM ${database}.simulation_events
        WHERE token_address = '${escapedMint}'
          AND chain = '${escapedChain}'
      `,
        format: 'JSONEachRow',
      });
      simulationsRun = parseInt(
        String((simResult.rows[0] as Record<string, unknown>)?.['count'] || 0),
        10
      );
    } catch (error) {
      if (ctx.logger.debug) {
        ctx.logger.debug('Failed to query simulations', { mint, error: (error as Error).message });
      }
    }

    // Determine if OHLCV is enriched (has candles around alert time)
    const ohlcvEnriched = timeframes.length > 0 && tokenCandleCount > 0;

    // Get ticker from calls if available (not in current schema, skip for now)
    const ticker: string | undefined = undefined;

    tokenStats.push({
      mint,
      chain,
      ticker,
      firstCallTime: firstCallTime.toISO()!,
      lastCallTime: lastCallTime.toISO()!,
      callCount,
      ohlcvEnriched,
      totalCandles: totalTokenCandles,
      timeframes,
      simulationsRun,
      dateRange,
    });

    // Update summary counters
    totalCandles += totalTokenCandles;
    totalSimulations += simulationsRun;
    if (ohlcvEnriched) {
      tokensWithOhlcv++;
    } else {
      tokensWithoutOhlcv++;
    }
  }

  return {
    timestamp,
    totalTokens: tokenStats.length,
    totalCalls: calls.length,
    tokens: tokenStats,
    summary: {
      tokensWithOhlcv,
      tokensWithoutOhlcv,
      totalCandles,
      totalSimulations,
    },
  };
}
