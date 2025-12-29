/**
 * Execute Patch Worklist Handler
 *
 * Executes a pre-calculated patch worklist using existing fetch handlers.
 * The worklist contains fetch windows calculated by ohlcv_patch_worklist.py
 */

import { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { logger } from '@quantbot/utils';
import { getStorageEngine } from '@quantbot/storage';
import { fetchBirdeyeCandles, getBirdeyeClient } from '@quantbot/api-clients';
import { storeCandles } from '@quantbot/ohlcv';
import { DateTime } from 'luxon';
import { validateAndProcessCandleSlice, type CandleSliceAudit } from './candle-validation.js';
import type { Chain } from '@quantbot/core';

export const executePatchWorklistSchema = z.object({
  worklist: z.string().min(1, 'Worklist file path is required'),
  concurrent: z.number().int().positive().default(45),
  eventsOnly: z.boolean().default(false),
});

export type ExecutePatchWorklistArgs = z.infer<typeof executePatchWorklistSchema>;

interface WorklistItem {
  mint: string;
  chain: string;
  interval: '1m' | '5m';
  alertTime: string;
  fromTime: string;
  toTime: string;
  fromUnix: number;
  toUnix: number;
  fetchType: 'normal' | 'gap_fill';
  hasExisting: boolean;
  firstCandleEpoch?: number; // First candle epoch (for gap fills)
  callCount: number;
}

interface Worklist {
  items: WorklistItem[];
  totalItems: number;
  totalTokens: number;
}

/**
 * Execute patch worklist
 */
export async function executePatchWorklistHandler(
  args: ExecutePatchWorklistArgs,
  ctx: CommandContext
) {
  const { resolve } = await import('path');
  const { readFile } = await import('fs/promises');
  const worklistPath = resolve(process.cwd(), args.worklist);

  if (!args.eventsOnly) {
    logger.info('Executing patch worklist', {
      worklistPath,
      concurrent: args.concurrent,
    });
  }

  // Load worklist
  const worklistContent = await readFile(worklistPath, 'utf-8');
  const worklist: Worklist = JSON.parse(worklistContent);

  if (!args.eventsOnly) {
    logger.info('Loaded patch worklist', {
      totalItems: worklist.totalItems,
      totalTokens: worklist.totalTokens,
    });
  }

  const results = {
    itemsProcessed: 0,
    itemsSucceeded: 0,
    itemsFailed: 0,
    totalCandlesFetched: 0,
    totalCandlesStored: 0,
    errors: [] as Array<{ mint: string; interval: string; error: string }>,
    audits: [] as CandleSliceAudit[],
  };

  // Process each worklist item
  const processItem = async (item: WorklistItem) => {
    try {
      results.itemsProcessed++;

      if (!args.eventsOnly) {
        logger.info(
          `Processing ${item.mint.substring(0, 20)}... (${item.interval}, ${item.fetchType})`,
          {
            mint: item.mint,
            chain: item.chain,
            interval: item.interval,
            fetchType: item.fetchType,
            fromTime: item.fromTime,
            toTime: item.toTime,
          }
        );
      }

      // Fetch candles
      let rawCandles: Awaited<ReturnType<typeof fetchBirdeyeCandles>> = [];
      const TARGET_COUNT = item.fetchType === 'gap_fill' ? 5000 : 10000;

      if (item.fetchType === 'gap_fill') {
        // For gap fills, fetch from fromUnix to toUnix (which includes 100 candles past firstCandleEpoch)
        // The worklist already includes the overlap in toUnix
        const birdeyeClient = getBirdeyeClient();
        const fromDate = new Date(item.fromUnix * 1000);
        const toDate = new Date(item.toUnix * 1000);

        const response = await birdeyeClient.fetchOHLCVData(
          item.mint,
          fromDate,
          toDate,
          item.interval,
          item.chain
        );

        if (response && response.items) {
          rawCandles = response.items.map((item) => ({
            timestamp: item.unixTime,
            open: item.open,
            high: item.high,
            low: item.low,
            close: item.close,
            volume: item.volume,
          }));
        }
      } else {
        // For normal fetches, use the existing handler (10,000 candles, 2 API calls)
        rawCandles = await fetchBirdeyeCandles(
          item.mint,
          item.interval,
          item.fromUnix,
          item.toUnix,
          item.chain
        );
      }

      if (rawCandles.length === 0) {
        if (!args.eventsOnly) {
          logger.info(`No candles found for ${item.mint} (${item.interval})`, {
            mint: item.mint,
            chain: item.chain,
            interval: item.interval,
          });
        }
        results.itemsSucceeded++; // Count as succeeded (no data available)
        return;
      }

      // For gap_fill, validate overlap and trim to perfect boundary
      let filteredCandles = rawCandles;
      if (item.fetchType === 'gap_fill' && item.firstCandleEpoch) {
        const intervalSeconds = item.interval === '1m' ? 60 : 300;

        // Separate candles into: before firstCandleEpoch (gap fill) and at/after (overlap for validation)
        const gapFillCandles = rawCandles.filter((c) => c.timestamp < item.firstCandleEpoch!);
        const overlapCandles = rawCandles.filter((c) => c.timestamp >= item.firstCandleEpoch!);

        // Validate overlap: fetch existing candles from ClickHouse and compare
        if (overlapCandles.length > 0) {
          const overlapStart = DateTime.fromSeconds(item.firstCandleEpoch, { zone: 'utc' });
          const overlapEnd = DateTime.fromSeconds(
            Math.max(...overlapCandles.map((c) => c.timestamp)),
            { zone: 'utc' }
          );

          const storageEngine = getStorageEngine();
          const existingCandles = await storageEngine.getCandles(
            item.mint,
            item.chain,
            overlapStart,
            overlapEnd,
            { interval: item.interval }
          );

          // Compare overlapping candles: check if timestamps match and values are close
          const existingCandlesMap = new Map(existingCandles.map((c) => [c.timestamp, c]));
          let matchCount = 0;
          let mismatchCount = 0;
          const maxPriceDiff = 0.01; // 1% tolerance for price differences

          for (const fetchedCandle of overlapCandles) {
            const existingCandle = existingCandlesMap.get(fetchedCandle.timestamp);
            if (existingCandle) {
              // Check if values are close (allowing for small differences due to data source variations)
              const priceDiff =
                Math.abs(fetchedCandle.close - existingCandle.close) / existingCandle.close;
              if (priceDiff <= maxPriceDiff) {
                matchCount++;
              } else {
                mismatchCount++;
                if (!args.eventsOnly) {
                  logger.warn(
                    `Overlap validation: price mismatch for ${item.mint} at ${fetchedCandle.timestamp}`,
                    {
                      mint: item.mint,
                      interval: item.interval,
                      timestamp: fetchedCandle.timestamp,
                      fetchedClose: fetchedCandle.close,
                      existingClose: existingCandle.close,
                      priceDiffPercent: (priceDiff * 100).toFixed(2),
                    }
                  );
                }
              }
            } else {
              mismatchCount++;
              if (!args.eventsOnly) {
                logger.warn(
                  `Overlap validation: missing candle in existing data for ${item.mint} at ${fetchedCandle.timestamp}`,
                  {
                    mint: item.mint,
                    interval: item.interval,
                    timestamp: fetchedCandle.timestamp,
                  }
                );
              }
            }
          }

          if (!args.eventsOnly) {
            logger.info(`Overlap validation for ${item.mint} (${item.interval})`, {
              mint: item.mint,
              interval: item.interval,
              overlapCandles: overlapCandles.length,
              existingCandles: existingCandles.length,
              matches: matchCount,
              mismatches: mismatchCount,
              matchRate:
                overlapCandles.length > 0
                  ? ((matchCount / overlapCandles.length) * 100).toFixed(1) + '%'
                  : 'N/A',
            });
          }

          // If most candles match, we have a good boundary. If not, log a warning.
          if (overlapCandles.length > 0 && matchCount / overlapCandles.length < 0.8) {
            logger.warn(
              `Overlap validation failed for ${item.mint}: only ${matchCount}/${overlapCandles.length} candles match`,
              {
                mint: item.mint,
                interval: item.interval,
                matchCount,
                totalOverlap: overlapCandles.length,
                matchRate: ((matchCount / overlapCandles.length) * 100).toFixed(1) + '%',
              }
            );
          }
        }

        // Trim to perfect boundary: only keep candles before firstCandleEpoch
        filteredCandles = gapFillCandles;

        if (!args.eventsOnly && overlapCandles.length > 0) {
          logger.debug(
            `Trimmed ${overlapCandles.length} overlap candles to get perfect boundary at firstCandleEpoch`,
            {
              mint: item.mint,
              interval: item.interval,
              gapFillCandles: gapFillCandles.length,
              overlapCandles: overlapCandles.length,
              firstCandleEpoch: item.firstCandleEpoch,
              firstCandleTime: DateTime.fromSeconds(item.firstCandleEpoch, {
                zone: 'utc',
              }).toISO()!,
            }
          );
        }

        // Verify first candle timestamp matches expected fromUnix
        if (filteredCandles.length > 0) {
          const firstCandle = filteredCandles[0];
          const expectedFromUnix = item.fromUnix;
          const diffSeconds = Math.abs(firstCandle.timestamp - expectedFromUnix);

          // Allow up to 1 interval difference (due to API rounding/alignment)
          if (diffSeconds > intervalSeconds) {
            logger.warn(`First candle timestamp mismatch for ${item.mint}`, {
              mint: item.mint,
              chain: item.chain,
              interval: item.interval,
              expectedFirstTimestamp: expectedFromUnix,
              expectedFirstTime: DateTime.fromSeconds(expectedFromUnix, { zone: 'utc' }).toISO()!,
              actualFirstTimestamp: firstCandle.timestamp,
              actualFirstTime: DateTime.fromSeconds(firstCandle.timestamp, {
                zone: 'utc',
              }).toISO()!,
              diffSeconds,
              diffIntervals: diffSeconds / intervalSeconds,
              fetchType: item.fetchType,
              firstCandleEpoch: item.firstCandleEpoch,
            });
          }
        }
      }

      if (filteredCandles.length === 0) {
        if (!args.eventsOnly) {
          logger.info(`No candles to store for ${item.mint} (${item.interval}) after filtering`, {
            mint: item.mint,
            chain: item.chain,
            interval: item.interval,
          });
        }
        results.itemsSucceeded++; // Count as succeeded
        return;
      }

      // Validate and process candle slice (dedup, gap check, alignment, trim)
      const { candles: validatedCandles, audit } = validateAndProcessCandleSlice(
        filteredCandles,
        item.mint,
        item.interval,
        TARGET_COUNT
      );

      // Store audit record
      results.audits.push(audit);

      // Log audit results
      if (!args.eventsOnly || !audit.simSafe) {
        logger.info(`Candle slice audit for ${item.mint} (${item.interval})`, {
          mint: item.mint,
          interval: item.interval,
          requestedCount: audit.requestedCount,
          fetchedCount: audit.fetchedCount,
          finalCount: audit.finalCount,
          duplicateCount: audit.duplicateCount,
          gapCount: audit.gapCount,
          alignmentOk: audit.alignmentOk,
          simSafe: audit.simSafe,
          minTs: audit.minTs,
          maxTs: audit.maxTs,
        });
      }

      if (validatedCandles.length === 0) {
        if (!args.eventsOnly) {
          logger.warn(`No valid candles after validation for ${item.mint} (${item.interval})`, {
            mint: item.mint,
            interval: item.interval,
            audit,
          });
        }
        results.itemsSucceeded++; // Count as succeeded (validation filtered all)
        return;
      }

      // Store validated candles
      await storeCandles(item.mint, item.chain as Chain, validatedCandles, item.interval);

      results.totalCandlesFetched += rawCandles.length;
      results.totalCandlesStored += validatedCandles.length;
      results.itemsSucceeded++;

      if (!args.eventsOnly) {
        logger.info(
          `Successfully stored ${validatedCandles.length} candles for ${item.mint} (${item.interval})`,
          {
            mint: item.mint,
            candlesFetched: rawCandles.length,
            candlesStored: validatedCandles.length,
            simSafe: audit.simSafe,
          }
        );
      } else {
        logger.info(
          `Stored ${validatedCandles.length} candles for ${item.mint} (${item.interval})${audit.simSafe ? '' : ' [NOT SIM-SAFE]'}`,
          {
            mint: item.mint,
            candlesStored: validatedCandles.length,
            simSafe: audit.simSafe,
          }
        );
      }
    } catch (error) {
      results.itemsFailed++;
      const errorMessage = error instanceof Error ? error.message : String(error);
      results.errors.push({ mint: item.mint, interval: item.interval, error: errorMessage });

      if (!args.eventsOnly) {
        logger.error(
          `Failed to process ${item.mint} (${item.interval})`,
          error instanceof Error ? error : new Error(errorMessage),
          {
            mint: item.mint,
            chain: item.chain,
            interval: item.interval,
          }
        );
      } else {
        logger.error(`Failed for ${item.mint} (${item.interval}): ${errorMessage}`, {
          mint: item.mint,
          interval: item.interval,
        });
      }
    }
  };

  // Process items with concurrency control
  const semaphore = { count: 0 };
  const maxConcurrent = args.concurrent;
  const processQueue: Array<() => Promise<void>> = [];

  for (const item of worklist.items) {
    processQueue.push(async () => {
      while (semaphore.count >= maxConcurrent) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      semaphore.count++;
      try {
        await processItem(item);
      } finally {
        semaphore.count--;
      }
    });
  }

  await Promise.all(processQueue.map((fn) => fn()));

  // Calculate audit summary
  const simSafeCount = results.audits.filter((a) => a.simSafe).length;
  const totalGaps = results.audits.reduce((sum, a) => sum + a.gapCount, 0);
  const totalDuplicates = results.audits.reduce((sum, a) => sum + a.duplicateCount, 0);
  const alignmentIssues = results.audits.filter((a) => !a.alignmentOk).length;

  if (!args.eventsOnly) {
    logger.info('Patch worklist execution complete', {
      itemsProcessed: results.itemsProcessed,
      itemsSucceeded: results.itemsSucceeded,
      itemsFailed: results.itemsFailed,
      totalCandlesFetched: results.totalCandlesFetched,
      totalCandlesStored: results.totalCandlesStored,
      errorCount: results.errors.length,
      auditSummary: {
        totalSlices: results.audits.length,
        simSafeSlices: simSafeCount,
        totalGaps,
        totalDuplicates,
        alignmentIssues,
      },
    });
  }

  // Log non-sim-safe slices
  const nonSimSafe = results.audits.filter((a) => !a.simSafe);
  if (nonSimSafe.length > 0) {
    logger.warn(`Found ${nonSimSafe.length} non-sim-safe candle slices`, {
      nonSimSafeSlices: nonSimSafe.map((a) => ({
        token: a.token,
        interval: a.interval,
        gapCount: a.gapCount,
        duplicateCount: a.duplicateCount,
        alignmentOk: a.alignmentOk,
        finalCount: a.finalCount,
        requestedCount: a.requestedCount,
      })),
    });
  }

  return results;
}
