/**
 * Ensure OHLCV Coverage Handler
 *
 * Checks and fetches OHLCV candles for all tokens in calls database <3 months old.
 * Ensures minimum coverage:
 * - 5000 15s candles
 * - 10,000 1m candles
 * - 10,000 5m candles
 */

import path from 'node:path';
import { DateTime } from 'luxon';
import { ConfigurationError } from '@quantbot/utils';
import { ingestOhlcv, createOhlcvIngestionContext } from '@quantbot/workflows';
import type { IngestOhlcvSpec } from '@quantbot/workflows';
import { getCoverage } from '@quantbot/ohlcv';
import { createQueryCallsDuckdbContext, queryCallsDuckdb } from '@quantbot/workflows';
import type { CommandContext } from '../../core/command-context.js';
import { ensureOhlcvCoverageSchema } from '../../commands/ingestion.js';
import type { z } from 'zod';
import { logger } from '@quantbot/utils';

export type EnsureOhlcvCoverageArgs = z.infer<typeof ensureOhlcvCoverageSchema>;

interface TokenInfo {
  mint: string;
  chain: string;
  earliestCall: DateTime;
}

/**
 * Query all unique tokens from calls database <3 months old
 */
async function queryRecentTokens(
  duckdbPath: string,
  maxAgeDays: number = 90
): Promise<TokenInfo[]> {
  const cutoffDate = DateTime.utc().minus({ days: maxAgeDays });
  const fromISO = cutoffDate.toISO()!;
  const toISO = DateTime.utc().toISO()!;

  const queryContext = await createQueryCallsDuckdbContext(duckdbPath);

  // Query calls in the date range
  const result = await queryCallsDuckdb(
    {
      duckdbPath,
      fromISO,
      toISO,
      limit: 100000, // Large limit to get all calls
    },
    queryContext
  );

  // Group by mint to get earliest call per token
  const tokenMap = new Map<string, TokenInfo>();

  for (const call of result.calls) {
    const mint = call.mint;
    // CallRecord.createdAt is always DateTime (from packages/workflows/src/types.ts)
    const callTime = call.createdAt;

    if (!tokenMap.has(mint) || callTime < tokenMap.get(mint)!.earliestCall) {
      tokenMap.set(mint, {
        mint,
        chain: 'solana', // Default, will be detected during fetch
        earliestCall: callTime,
      });
    }
  }

  return Array.from(tokenMap.values());
}

/**
 * Check coverage for a token and interval
 */
async function checkTokenCoverage(
  mint: string,
  chain: string,
  alertTime: DateTime,
  interval: '15s' | '1m' | '5m',
  minCandles: number
): Promise<{ hasEnough: boolean; candleCount: number }> {
  // Calculate time range: from 3 days before alert to now
  const fromTime = alertTime.minus({ days: 3 });
  const toTime = DateTime.utc();

  try {
    const coverage = await getCoverage(
      mint,
      chain as 'solana' | 'ethereum' | 'base' | 'bsc',
      fromTime.toJSDate(),
      toTime.toJSDate(),
      interval
    );

    return {
      hasEnough: coverage.candleCount >= minCandles,
      candleCount: coverage.candleCount,
    };
  } catch (error) {
    logger.warn(`Failed to check coverage for ${mint.substring(0, 20)}...`, {
      interval,
      error: error instanceof Error ? error.message : String(error),
    });
    return { hasEnough: false, candleCount: 0 };
  }
}

/**
 * Fetch candles for a token and interval
 */
async function fetchCandlesForToken(
  mint: string,
  chain: string,
  alertTime: DateTime,
  interval: '15s' | '1m' | '5m',
  duckdbPath: string
): Promise<{ success: boolean; candlesFetched: number; error?: string }> {
  const workflowCtx = await createOhlcvIngestionContext({ duckdbPath });

  // Calculate time range to ensure we get enough candles
  // For 15s: 5000 candles = ~20.8 hours, fetch 1 day before alert to 1 day after
  // For 1m: 10,000 candles = ~6.94 days, fetch 1 week before alert to 1 week after
  // For 5m: 10,000 candles = ~34.7 days, fetch 1 month before alert to 1 month after
  let preWindow: number;
  let postWindow: number;

  if (interval === '15s') {
    preWindow = 1440; // 1 day
    postWindow = 1440; // 1 day
  } else if (interval === '1m') {
    preWindow = 10080; // 1 week
    postWindow = 10080; // 1 week
  } else {
    // 5m
    preWindow = 43200; // 1 month
    postWindow = 43200; // 1 month
  }

  // Calculate from/to dates based on alert time and windows
  const fromTime = alertTime.minus({ minutes: preWindow });
  const toTime = alertTime.plus({ minutes: postWindow });

  const spec: IngestOhlcvSpec = {
    duckdbPath,
    chain: chain as 'solana' | 'ethereum' | 'base' | 'bsc',
    interval,
    from: fromTime.toISO()!,
    to: toTime.toISO()!,
    preWindowMinutes: preWindow,
    postWindowMinutes: postWindow,
    side: 'buy',
    errorMode: 'collect',
    checkCoverage: true,
    rateLimitMs: 330,
    maxRetries: 3,
    mints: [mint], // Only fetch for this specific mint
  };

  try {
    const result = await ingestOhlcv(spec, workflowCtx);
    return {
      success: result.workItemsFailed === 0,
      candlesFetched: result.totalCandlesFetched,
      error:
        result.errors && result.errors.length > 0
          ? result.errors.map((e) => e.error).join('; ')
          : undefined,
    };
  } catch (error) {
    return {
      success: false,
      candlesFetched: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * CLI handler for ensuring OHLCV coverage
 */
export async function ensureOhlcvCoverageHandler(
  args: EnsureOhlcvCoverageArgs,
  _ctx: CommandContext
) {
  const duckdbPathRaw = args.duckdb || process.env.DUCKDB_PATH;
  if (!duckdbPathRaw) {
    throw new ConfigurationError(
      'DuckDB path is required. Provide --duckdb or set DUCKDB_PATH environment variable.',
      'duckdbPath',
      { args, env: { DUCKDB_PATH: process.env.DUCKDB_PATH } }
    );
  }
  const duckdbPath = path.resolve(duckdbPathRaw);

  const maxAgeDays = args.maxAgeDays || 90; // Default to 3 months

  logger.info('Querying tokens from calls database', {
    duckdbPath,
    maxAgeDays,
  });

  // Query all tokens <3 months old
  const tokens = await queryRecentTokens(duckdbPath, maxAgeDays);

  logger.info(`Found ${tokens.length} tokens to check`);

  const results = {
    totalTokens: tokens.length,
    tokensChecked: 0,
    tokensFetched: 0,
    intervalsFetched: {
      '15s': 0,
      '1m': 0,
      '5m': 0,
    },
    errors: [] as Array<{ mint: string; interval: string; error: string }>,
  };

  // Process each token
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    results.tokensChecked++;

    logger.info(`Processing token ${i + 1}/${tokens.length}: ${token.mint.substring(0, 20)}...`, {
      earliestCall: token.earliestCall.toISO(),
    });

    // Check and fetch for each interval
    const intervals: Array<{ interval: '15s' | '1m' | '5m'; minCandles: number }> = [
      { interval: '15s', minCandles: 5000 },
      { interval: '1m', minCandles: 10000 },
      { interval: '5m', minCandles: 10000 },
    ];

    for (const { interval, minCandles } of intervals) {
      // Check coverage
      const coverage = await checkTokenCoverage(
        token.mint,
        token.chain,
        token.earliestCall,
        interval,
        minCandles
      );

      if (!coverage.hasEnough) {
        logger.info(
          `Fetching ${interval} candles for ${token.mint.substring(0, 20)}... (has ${coverage.candleCount}, needs ${minCandles})`
        );

        const fetchResult = await fetchCandlesForToken(
          token.mint,
          token.chain,
          token.earliestCall,
          interval,
          duckdbPath
        );

        if (fetchResult.success) {
          results.intervalsFetched[interval]++;
          logger.info(
            `Fetched ${fetchResult.candlesFetched} ${interval} candles for ${token.mint.substring(0, 20)}...`
          );
        } else {
          results.errors.push({
            mint: token.mint,
            interval,
            error: fetchResult.error || 'Unknown error',
          });
          logger.error(
            `Failed to fetch ${interval} candles for ${token.mint.substring(0, 20)}...`,
            { error: fetchResult.error }
          );
        }

        // Rate limiting between fetches
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else {
        logger.debug(
          `Token ${token.mint.substring(0, 20)}... has sufficient ${interval} coverage (${coverage.candleCount} candles)`
        );
      }
    }

    // Progress update every 10 tokens
    if ((i + 1) % 10 === 0) {
      logger.info(`Progress: ${i + 1}/${tokens.length} tokens processed`);
    }
  }

  results.tokensFetched =
    results.intervalsFetched['15s'] +
    results.intervalsFetched['1m'] +
    results.intervalsFetched['5m'];

  if (args.format === 'json') {
    return results;
  }

  // Build summary format
  return [
    {
      type: 'SUMMARY',
      totalTokens: results.totalTokens,
      tokensChecked: results.tokensChecked,
      intervalsFetched: results.intervalsFetched,
      errors: results.errors.length,
    },
    ...(results.errors.length > 0
      ? results.errors.map((err) => ({
          type: 'ERROR',
          mint: err.mint.substring(0, 20) + (err.mint.length > 20 ? '...' : ''),
          interval: err.interval,
          error: err.error,
        }))
      : []),
  ];
}
