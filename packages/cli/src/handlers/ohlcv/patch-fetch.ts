/**
 * Patch Fetch OHLCV Handler
 *
 * Fills the 10-hour gap in OHLCV coverage caused by timezone bug.
 * - For tokens with NO candles: Normal 10,000 candle fetch (2 API calls) for both 1m and 5m
 * - For tokens WITH existing candles: Fetch backwards to fill gap
 *   - Start from 10 hours ahead of alert (where we incorrectly fetched)
 *   - Fetch backwards: -83 hours for 1m (5000 candles), -416 hours for 5m (5000 candles)
 */

import { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { DateTime } from 'luxon';
import { logger, RateLimitError } from '@quantbot/utils';
import { getDuckDBWorklistService, getStorageEngine } from '@quantbot/storage';
import { fetchBirdeyeCandles } from '@quantbot/api-clients';
import { storeCandles } from '@quantbot/ohlcv';
import type { Chain } from '@quantbot/core';

/**
 * Exponential backoff with jitter for rate limit handling
 */
async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateBackoffDelay(
  attempt: number,
  baseDelayMs: number = 1000,
  maxDelayMs: number = 60000
): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * 0.25 * exponentialDelay;
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

function isRateLimitError(error: unknown): boolean {
  if (error instanceof RateLimitError) {
    return true;
  }
  if (error instanceof Error) {
    if (
      error.message.includes('429') ||
      error.message.includes('rate limit') ||
      error.message.includes('Rate limit')
    ) {
      return true;
    }
  }
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const axiosError = error as { response?: { status?: number } };
    if (axiosError.response?.status === 429) {
      return true;
    }
  }
  return false;
}

export const patchFetchSchema = z.object({
  duckdb: z.string().min(1, 'DuckDB path is required'),
  from: z.string().optional(),
  to: z.string().optional(),
  side: z.enum(['buy', 'sell']).default('buy'),
  format: z.enum(['json', 'table', 'csv']).default('table'),
  chain: z.enum(['solana', 'ethereum', 'bsc', 'base']).optional(),
  concurrent: z.number().int().positive().default(1),
  eventsOnly: z.boolean().default(false),
});

export type PatchFetchArgs = z.infer<typeof patchFetchSchema>;

/**
 * Patch fetch OHLCV to fill 10-hour gap
 */
export async function patchFetchHandler(args: PatchFetchArgs, ctx: CommandContext) {
  const { resolve } = await import('path');
  const duckdbPath = resolve(process.cwd(), args.duckdb);

  if (!args.eventsOnly) {
    logger.info('Patch fetching OHLCV to fill 10-hour gap', {
      duckdbPath,
      side: args.side,
      from: args.from,
      to: args.to,
      concurrent: args.concurrent,
    });
  }

  // Query DuckDB for worklist
  const worklistService = getDuckDBWorklistService();
  const worklist = await worklistService.queryWorklist({
    duckdbPath,
    from: args.from,
    to: args.to,
    side: args.side,
  });

  if (!args.eventsOnly) {
    logger.info('Found alerts in DuckDB', {
      tokenGroups: worklist.tokenGroups.length,
      calls: worklist.calls.length,
    });
  }

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
    };
  }

  // Optional: Filter by specific mints if provided via environment variable
  const allowedMints = process.env.OHLCV_FETCH_MINTS
    ? new Set(process.env.OHLCV_FETCH_MINTS.split(',').map((m) => m.trim()))
    : null;

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

    if (allowedMints && !allowedMints.has(group.mint)) {
      continue;
    }

    if (args.chain && group.chain && group.chain !== args.chain) {
      continue;
    }

    const alertTime = DateTime.fromISO(group.earliestAlertTime, { zone: 'utc' });
    if (!alertTime.isValid) continue;

    const existing = mintMap.get(group.mint);
    if (!existing || alertTime < existing.earliestAlertTime) {
      mintMap.set(group.mint, {
        mint: group.mint,
        chain: group.chain || 'solana',
        earliestAlertTime: alertTime,
        callCount: group.callCount || 0,
      });
    }
  }

  const uniqueMints = Array.from(mintMap.values());
  if (!args.eventsOnly) {
    logger.info(`Processing ${uniqueMints.length} unique mints for patch fetch`, {
      uniqueMints: uniqueMints.length,
    });
  }

  const storageEngine = getStorageEngine();
  const results = {
    alertsProcessed: worklist.calls.length,
    uniqueMints: uniqueMints.length,
    fetchesAttempted: 0,
    fetchesSucceeded: 0,
    fetchesFailed: 0,
    totalCandlesFetched: 0,
    totalCandlesStored: 0,
    errors: [] as Array<{ mint: string; error: string }>,
  };

  // Process each mint for both 1m and 5m intervals
  const processMint = async ({ mint, chain, earliestAlertTime }: (typeof uniqueMints)[0]) => {
    for (const interval of ['1m', '5m'] as const) {
      try {
        results.fetchesAttempted++;

        const intervalSeconds = interval === '1m' ? 60 : 300;
        const lookbackSeconds = 52 * intervalSeconds; // 52 candles before alert

        // Check if token has any candles for this interval
        const wideStartTime = DateTime.now().minus({ years: 2 });
        const wideEndTime = DateTime.now();

        let hasExistingCandles = false;
        try {
          const existingCandles = await storageEngine.getCandles(
            mint,
            chain,
            wideStartTime,
            wideEndTime,
            { interval }
          );
          hasExistingCandles = existingCandles.length > 0;
        } catch (error) {
          // If check fails, assume no candles and do normal fetch
          logger.debug(`Failed to check existing candles for ${mint}, assuming no candles`, {
            mint,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        let candles: Awaited<ReturnType<typeof fetchBirdeyeCandles>> = [];

        if (!hasExistingCandles) {
          // No existing candles: Do normal 10,000 candle fetch (2 API calls)
          if (!args.eventsOnly) {
            logger.info(
              `No existing candles for ${mint} (${interval}), doing normal 10,000 candle fetch`,
              {
                mint,
                chain,
                interval,
              }
            );
          }

          const TOTAL_CANDLES = 10000;
          const defaultForwardCandles = TOTAL_CANDLES - 52;
          const defaultForwardSeconds = defaultForwardCandles * intervalSeconds;
          const toUTC = earliestAlertTime.plus({ seconds: defaultForwardSeconds });
          const fromUTC = earliestAlertTime.minus({ seconds: lookbackSeconds });

          const fromUnix = Math.floor(fromUTC.toSeconds());
          const toUnix = Math.floor(toUTC.toSeconds());

          // Fetch with retries
          const maxRetries = 5;
          let lastError: unknown = null;

          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
              candles = await fetchBirdeyeCandles(mint, interval, fromUnix, toUnix, chain);
              lastError = null;
              break;
            } catch (error) {
              lastError = error;
              if (isRateLimitError(error) && attempt < maxRetries) {
                const delay = calculateBackoffDelay(attempt);
                if (!args.eventsOnly) {
                  logger.warn(`Rate limited, retrying in ${delay}ms...`, {
                    mint,
                    attempt: attempt + 1,
                  });
                }
                await sleep(delay);
                continue;
              }
              throw error;
            }
          }

          if (lastError) {
            throw lastError;
          }
        } else {
          // Has existing candles: Fetch backwards to fill gap
          // Start from 10 hours ahead of alert (where we incorrectly fetched)
          // Fetch backwards: -83 hours for 1m (5000 candles), -416 hours for 5m (5000 candles)

          const wrongAlertTime = earliestAlertTime.plus({ hours: 10 }); // 10 hours ahead (where we fetched)

          // Calculate backwards fetch window
          // For 1m: -83 hours = -4980 minutes = 4980 candles (close to 5000)
          // For 5m: -416 hours = -24960 minutes = 4992 candles (close to 5000)
          const gapHours = interval === '1m' ? 83 : 416;
          const gapSeconds = gapHours * 3600;

          // time_from = wrong_alert_time - gap (this is where we start fetching backwards)
          // We fetch 5000 candles forward from this point
          const gapStartTime = wrongAlertTime.minus({ seconds: gapSeconds });
          const gapEndTime = wrongAlertTime; // End at the wrong alert time (where existing candles start)

          if (!args.eventsOnly) {
            logger.info(`Filling gap for ${mint} (${interval})`, {
              mint,
              chain,
              interval,
              actualAlertTime: earliestAlertTime.toISO()!,
              wrongAlertTime: wrongAlertTime.toISO()!,
              gapStartTime: gapStartTime.toISO()!,
              gapEndTime: gapEndTime.toISO()!,
              gapHours,
            });
          }

          const fromUnix = Math.floor(gapStartTime.toSeconds());
          const toUnix = Math.floor(gapEndTime.toSeconds());

          // Fetch 5000 candles to fill the gap
          // We'll use count mode which fetches forward from time_from
          // So we set time_from to gapStartTime and fetch 5000 candles
          const maxRetries = 5;
          let lastError: unknown = null;

          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
              // Fetch 5000 candles starting from gapStartTime
              // Since count mode fetches forward, this will fill the gap up to gapEndTime
              candles = await fetchBirdeyeCandles(mint, interval, fromUnix, toUnix, chain);
              lastError = null;
              break;
            } catch (error) {
              lastError = error;
              if (isRateLimitError(error) && attempt < maxRetries) {
                const delay = calculateBackoffDelay(attempt);
                if (!args.eventsOnly) {
                  logger.warn(`Rate limited, retrying in ${delay}ms...`, {
                    mint,
                    attempt: attempt + 1,
                  });
                }
                await sleep(delay);
                continue;
              }
              throw error;
            }
          }

          if (lastError) {
            throw lastError;
          }

          // Filter candles to only include those in the gap (before wrongAlertTime)
          const wrongAlertUnix = Math.floor(wrongAlertTime.toSeconds());
          candles = candles.filter((c) => c.timestamp < wrongAlertUnix);
        }

        if (candles.length === 0) {
          if (!args.eventsOnly) {
            logger.info(`No candles found for ${mint} (${interval})`, {
              mint,
              chain,
              interval,
            });
          }
          results.fetchesSucceeded++; // Count as succeeded (no data available)
          return;
        }

        // Store candles
        const storeStart = Date.now();
        await storeCandles(mint, chain as Chain, candles, interval);
        const storeDuration = Date.now() - storeStart;

        results.totalCandlesFetched += candles.length;
        results.totalCandlesStored += candles.length;
        results.fetchesSucceeded++;

        if (!args.eventsOnly) {
          logger.info(
            `Successfully fetched and stored ${candles.length} candles for ${mint} (${interval})`,
            {
              mint,
              candlesFetched: candles.length,
              storeDurationMs: storeDuration,
            }
          );
        } else {
          // Events-only mode: only log storage events
          logger.info(`Stored ${candles.length} candles for ${mint} (${interval})`, {
            mint,
            candlesStored: candles.length,
          });
        }
      } catch (error) {
        results.fetchesFailed++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        results.errors.push({ mint, error: errorMessage });

        if (!args.eventsOnly) {
          logger.error(
            `Failed to fetch OHLCV for ${mint}`,
            error instanceof Error ? error : new Error(errorMessage),
            {
              mint,
              chain,
              interval,
            }
          );
        } else {
          logger.error(`Failed for ${mint} (${interval}): ${errorMessage}`, {
            mint,
            interval,
          });
        }
      }
    }
  };

  // Process mints with concurrency control
  const semaphore = { count: 0 };
  const maxConcurrent = args.concurrent;
  const processQueue: Array<() => Promise<void>> = [];

  for (const mintData of uniqueMints) {
    processQueue.push(async () => {
      while (semaphore.count >= maxConcurrent) {
        await sleep(100);
      }
      semaphore.count++;
      try {
        await processMint(mintData);
      } finally {
        semaphore.count--;
      }
    });
  }

  await Promise.all(processQueue.map((fn) => fn()));

  if (!args.eventsOnly) {
    logger.info('Patch fetch complete', {
      alertsProcessed: results.alertsProcessed,
      uniqueMints: results.uniqueMints,
      fetchesAttempted: results.fetchesAttempted,
      fetchesSucceeded: results.fetchesSucceeded,
      fetchesFailed: results.fetchesFailed,
      totalCandlesFetched: results.totalCandlesFetched,
      totalCandlesStored: results.totalCandlesStored,
      errorCount: results.errors.length,
    });
  }

  return results;
}
