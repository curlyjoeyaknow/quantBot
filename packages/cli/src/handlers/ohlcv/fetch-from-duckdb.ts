/**
 * Fetch OHLCV from DuckDB Alerts Handler
 *
 * Reads alerts/calls from DuckDB and runs direct fetch for each unique mint.
 * Groups by mint to avoid duplicate fetches.
 * Processes mints in parallel with concurrency control and exponential backoff on rate limits.
 */

import { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { DateTime } from 'luxon';
import { logger, RateLimitError } from '@quantbot/utils';
import { getDuckDBWorklistService } from '@quantbot/storage';
import { fetchBirdeyeCandles } from '@quantbot/api-clients';
import { storeCandles } from '@quantbot/ohlcv';
import type { Chain } from '@quantbot/core';

/**
 * Simple concurrency limiter using a semaphore pattern
 */
class ConcurrencyLimiter {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private limit: number) {}

  async acquire(): Promise<void> {
    return new Promise((resolve) => {
      if (this.running < this.limit) {
        this.running++;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) {
      this.running++;
      next();
    }
  }
}

export const fetchFromDuckdbSchema = z.object({
  duckdb: z.string().min(1, 'DuckDB path is required'),
  interval: z.enum(['1s', '15s', '1m', '5m', '1H']).default('5m'),
  from: z.string().optional(), // ISO date string - filter alerts by date
  to: z.string().optional(), // ISO date string - filter alerts by date
  side: z.enum(['buy', 'sell']).default('buy'),
  format: z.enum(['json', 'table', 'csv']).default('table'),
  chain: z.enum(['solana', 'ethereum', 'bsc', 'base']).optional(), // Filter by chain if provided
  concurrency: z.number().int().min(1).max(100).optional().default(20), // Max parallel mints to fetch
});

export type FetchFromDuckdbArgs = z.infer<typeof fetchFromDuckdbSchema>;

/**
 * Fetch OHLCV for all alerts in DuckDB
 */
export async function fetchFromDuckdbHandler(args: FetchFromDuckdbArgs, _ctx: CommandContext) {
  const { resolve } = await import('path');
  const duckdbPath = resolve(process.cwd(), args.duckdb);

  logger.info('Fetching OHLCV for alerts from DuckDB', {
    duckdbPath,
    interval: args.interval,
    side: args.side,
    from: args.from,
    to: args.to,
    concurrency: args.concurrency,
  });

  // Query DuckDB for worklist (alerts/calls)
  const worklistService = getDuckDBWorklistService();
  const worklist = await worklistService.queryWorklist({
    duckdbPath,
    from: args.from,
    to: args.to,
    side: args.side,
  });

  logger.info('Found alerts in DuckDB', {
    tokenGroups: worklist.tokenGroups.length,
    calls: worklist.calls.length,
  });

  if (worklist.tokenGroups.length === 0) {
    return {
      alertsProcessed: 0,
      uniqueMints: 0,
      fetchesAttempted: 0,
      fetchesSucceeded: 0,
      fetchesFailed: 0,
      totalCandlesFetched: 0,
      totalCandlesStored: 0,
      errors: [],
      rateLimitErrors: 0,
    };
  }

  // Group by mint to get unique mints with earliest alert time
  const mintMap = new Map<
    string,
    {
      mint: string;
      chain: string;
      earliestAlertTime: DateTime;
      callCount: number;
    }
  >();

  for (const group of worklist.tokenGroups) {
    if (!group.mint || !group.earliestAlertTime) continue;

    // Filter by chain if provided
    if (args.chain && group.chain && group.chain !== args.chain) {
      continue;
    }

    const alertTime = DateTime.fromISO(group.earliestAlertTime, { zone: 'utc' });
    if (!alertTime.isValid) continue;

    const existing = mintMap.get(group.mint);
    if (!existing || alertTime < existing.earliestAlertTime) {
      mintMap.set(group.mint, {
        mint: group.mint,
        chain: group.chain || 'solana', // Default to solana if not specified
        earliestAlertTime: alertTime,
        callCount: group.callCount || 0,
      });
    }
  }

  const uniqueMints = Array.from(mintMap.values());
  logger.info(`Processing ${uniqueMints.length} unique mints`, {
    uniqueMints: uniqueMints.length,
  });

  // Calculate interval seconds for -52 candles lookback
  const intervalSeconds =
    args.interval === '1s'
      ? 1
      : args.interval === '15s'
        ? 15
        : args.interval === '1m'
          ? 60
          : args.interval === '5m'
            ? 300
            : 3600; // 1H

  const lookbackSeconds = 52 * intervalSeconds;

  // Fetch candles for each unique mint with parallel processing
  const results = {
    alertsProcessed: worklist.calls.length,
    uniqueMints: uniqueMints.length,
    fetchesAttempted: 0,
    fetchesSucceeded: 0,
    fetchesFailed: 0,
    totalCandlesFetched: 0,
    totalCandlesStored: 0,
    errors: [] as Array<{ mint: string; error: string }>,
    rateLimitErrors: 0,
  };

  // Concurrency control and rate limit tracking
  const concurrency = args.concurrency ?? 20;
  const limiter = new ConcurrencyLimiter(concurrency);
  const RATE_LIMIT_WINDOW_MS = 5000; // Track rate limits over 5 second window
  const rateLimitErrors: number[] = []; // Timestamps of recent rate limit errors (shared across all workers)

  logger.info(`Processing ${uniqueMints.length} mints with concurrency limit of ${concurrency}`, {
    totalMints: uniqueMints.length,
    concurrency,
  });

  // Process mints in parallel with concurrency control
  const fetchPromises = uniqueMints.map(async ({ mint, chain, earliestAlertTime }) => {
    await limiter.acquire();
    try {
      results.fetchesAttempted++;

      // Calculate fetch window: -52 candles before alert, and 19,948 candles after (20,000 total)
      // This ensures exactly 20,000 candles (4 × 5000 API calls): 52 before + 19,948 after
      // If --to is provided, use that instead
      const totalCandles = 4 * 5000; // 20000 candles total
      const forwardCandles = totalCandles - 52; // 19948 candles after alert
      const forwardSeconds = forwardCandles * intervalSeconds;
      const toUTC = args.to
        ? DateTime.fromISO(args.to, { zone: 'utc' }).toUTC()
        : earliestAlertTime.plus({ seconds: forwardSeconds });
      const fromUTC = earliestAlertTime.minus({ seconds: lookbackSeconds });

      logger.debug(`Fetching OHLCV for mint ${mint.substring(0, 20)}...`, {
        mint,
        chain,
        interval: args.interval,
        alertTime: earliestAlertTime.toISO()!,
        from: fromUTC.toISO()!,
        to: toUTC.toISO()!,
        lookbackCandles: 52,
        forwardCandles: args.to ? 'custom' : forwardCandles,
        totalCandles: args.to ? undefined : totalCandles,
      });

      const fromUnix = Math.floor(fromUTC.toSeconds());
      const toUnix = Math.floor(toUTC.toSeconds());

      // Check coverage - skip if we already have 20,000 candles (4 × 5000)
      const MIN_REQUIRED_CANDLES_FOR_20K = 20000;
      const { getCoverage } = await import('@quantbot/ohlcv');
      const coverage = await getCoverage(
        mint,
        chain as Chain,
        new Date(fromUnix * 1000),
        new Date(toUnix * 1000),
        args.interval
      );

      if (coverage.hasData && coverage.candleCount >= MIN_REQUIRED_CANDLES_FOR_20K) {
        logger.debug(`Skipping fetch for ${mint} - already have 20,000+ candles`, {
          mint,
          chain,
          interval: args.interval,
          existingCandles: coverage.candleCount,
          requiredCandles: MIN_REQUIRED_CANDLES_FOR_20K,
        });
        return; // Skip this mint
      }

      // Check for recent rate limit errors and back off if needed
      const now = Date.now();
      // Clean up old rate limit errors outside the window
      while (rateLimitErrors.length > 0 && now - rateLimitErrors[0]! > RATE_LIMIT_WINDOW_MS) {
        rateLimitErrors.shift();
      }
      const recentRateLimitErrors = rateLimitErrors.length;
      if (recentRateLimitErrors >= 5) {
        // If 5+ rate limit errors in last 5 seconds, back off
        const backoffDelay = Math.min(1000 * Math.pow(2, recentRateLimitErrors - 5), 10000); // Max 10s
        logger.warn(`Rate limit detected, backing off for ${backoffDelay}ms`, {
          recentRateLimitErrors,
          backoffDelayMs: backoffDelay,
          concurrency,
        });
        await new Promise((resolve) => setTimeout(resolve, backoffDelay));
      }

      // Fetch candles with retry on rate limit
      let fetchStart = Date.now();
      let lastError: Error | undefined;
      let retries = 0;
      const maxRetries = 3;
      let candles: Awaited<ReturnType<typeof fetchBirdeyeCandles>> = [];

      while (retries <= maxRetries) {
        try {
          fetchStart = Date.now();
          candles = await fetchBirdeyeCandles(mint, args.interval, fromUnix, toUnix, chain);
          lastError = undefined;
          break; // Success
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));

          // Check if it's a rate limit error
          const isRateLimit =
            lastError instanceof RateLimitError ||
            lastError.message.includes('429') ||
            lastError.message.includes('rate limit') ||
            lastError.message.includes('Too Many Requests');

          if (isRateLimit) {
            rateLimitErrors.push(Date.now());
            results.rateLimitErrors++;

            // Exponential backoff: 1s, 2s, 4s
            const backoffDelay = 1000 * Math.pow(2, retries);
            logger.warn(`Rate limit error for ${mint}, retrying after ${backoffDelay}ms`, {
              mint,
              retry: retries + 1,
              maxRetries,
              backoffDelayMs: backoffDelay,
            });
            await new Promise((resolve) => setTimeout(resolve, backoffDelay));
            retries++;
          } else {
            // Non-rate-limit error, throw immediately
            throw error;
          }
        }
      }

      if (lastError) {
        // All retries exhausted
        throw lastError;
      }

      const fetchDuration = Date.now() - fetchStart;

      if (candles.length > 0) {
        // Store candles
        const storeStart = Date.now();
        await storeCandles(mint, chain as Chain, candles, args.interval);
        const storeDuration = Date.now() - storeStart;

        results.fetchesSucceeded++;
        results.totalCandlesFetched += candles.length;
        results.totalCandlesStored += candles.length;

        logger.debug(`Successfully fetched and stored ${candles.length} candles for ${mint}`, {
          mint,
          candlesFetched: candles.length,
          fetchDurationMs: fetchDuration,
          storeDurationMs: storeDuration,
        });
      } else {
        results.fetchesFailed++;
        const errorMsg = `No candles available for mint ${mint} on ${chain}`;
        results.errors.push({ mint, error: errorMsg });
        logger.debug(`No candles found for ${mint}`, {
          mint,
          chain,
          interval: args.interval,
          from: fromUTC.toISO()!,
          to: toUTC.toISO()!,
        });
      }
    } catch (error) {
      results.fetchesFailed++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.errors.push({ mint, error: errorMsg });
      logger.error(`Failed to fetch OHLCV for ${mint}`, {
        mint,
        chain,
        error: errorMsg,
      });
    } finally {
      limiter.release();
    }
  });

  // Wait for all fetches to complete
  await Promise.allSettled(fetchPromises);

  logger.info('Completed fetching OHLCV for all alerts', {
    fetchesAttempted: results.fetchesAttempted,
    fetchesSucceeded: results.fetchesSucceeded,
    fetchesFailed: results.fetchesFailed,
    totalCandlesFetched: results.totalCandlesFetched,
    totalCandlesStored: results.totalCandlesStored,
    rateLimitErrors: results.rateLimitErrors,
    concurrency: concurrency,
  });

  return results;
}
