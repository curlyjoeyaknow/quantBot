/**
 * OHLCV Work Planning Service (Offline-Only)
 * ===========================================
 *
 * Generates worklists for OHLCV fetching by querying DuckDB.
 * This service is 100% offline and does NOT make any API calls.
 *
 * Responsibilities:
 * - Read DuckDB calls/tokens
 * - Produce worklist: (mint, chain, interval, start, end, priority)
 * - Write OHLCV metadata/exclusions back to DuckDB (offline)
 *
 * Forbidden:
 * - Any HTTP / Birdeye
 * - ClickHouse writes (optional, but kept out for now)
 * - "fetch" logic
 */

import { resolve } from 'path';
import { DateTime } from 'luxon';
import type { Chain, OhlcvWorkItem } from '@quantbot/core';
import { normalizeChain } from '@quantbot/core';
import { logger } from '@quantbot/utils';
import { getDuckDBWorklistService } from '@quantbot/storage';

// Re-export OhlcvWorkItem from core for backward compatibility
export type { OhlcvWorkItem } from '@quantbot/core';

/**
 * Options for generating worklist
 */
export interface WorklistOptions {
  from?: Date;
  to?: Date;
  side?: 'buy' | 'sell';
  chain?: Chain;
  interval?: '1s' | '15s' | '1m' | '5m' | '1H';
  preWindowMinutes?: number; // Minutes before alert to start fetching
  postWindowMinutes?: number; // Minutes after alert to end fetching
  mints?: string[]; // Optional: filter worklist to only include these mints (filtering happens after DuckDB query)
}

/**
 * Generate OHLCV worklist from DuckDB
 *
 * This is an offline operation that queries DuckDB to determine
 * what OHLCV data needs to be fetched.
 *
 * @param duckdbPath - Path to DuckDB database
 * @param options - Worklist generation options
 * @returns Array of work items to be processed by @quantbot/jobs
 */
export async function generateOhlcvWorklist(
  duckdbPath: string,
  options: WorklistOptions = {}
): Promise<OhlcvWorkItem[]> {
  const {
    from,
    to,
    side = 'buy',
    chain: rawChain = 'solana',
    interval = '1m',
    // Default windows to ensure 5000 candles are fetched for each interval
    // For 1m: 5000 candles = 5000 minutes = ~83.3 hours
    // For 5m: 5000 candles = 25000 minutes = ~416.7 hours
    // Using 52 minutes pre-window (as per OhlcvIngestionEngine), calculate post-window to get 5000 candles
    preWindowMinutes = 260, // Default: 260 minutes (52 * 5m) before alert
    // For 1m interval: 5000 - 260 = 4740 minutes post-window to get 5000 candles total
    // For 5m interval: 25000 - 260 = 24740 minutes post-window to get 5000 candles total
    // Default to 1m calculation (4740), but this should be adjusted based on interval
    postWindowMinutes = 4740, // Default: 4740 minutes to get 5000 candles for 1m interval
  } = options;

  // Normalize chain to lowercase
  const chain = normalizeChain(rawChain) as Chain;

  // Convert relative paths to absolute paths (Python scripts run from different working directories)
  const absoluteDuckdbPath = resolve(process.cwd(), duckdbPath);

  logger.info('Generating OHLCV worklist from DuckDB', {
    duckdbPath: absoluteDuckdbPath,
    from: from?.toISOString(),
    to: to?.toISOString(),
    side,
    chain,
    interval,
  });

  const worklistService = getDuckDBWorklistService();

  // Query DuckDB for worklist (don't pass mints to Python - filter in TypeScript instead)
  const worklist = await worklistService.queryWorklist({
    duckdbPath: absoluteDuckdbPath,
    from: from?.toISOString(),
    to: to?.toISOString(),
    side,
  });

  logger.info('Found worklist from DuckDB', {
    tokenGroups: worklist.tokenGroups.length,
    calls: worklist.calls.length,
  });

  // Filter token groups by mints if provided (case-sensitive exact match)
  let filteredTokenGroups = worklist.tokenGroups;
  if (options.mints !== undefined && options.mints.length > 0) {
    const mintsSet = new Set(options.mints);
    filteredTokenGroups = worklist.tokenGroups.filter(
      (group) => group.mint && mintsSet.has(group.mint)
    );
    logger.info('Filtered worklist by mints', {
      originalCount: worklist.tokenGroups.length,
      filteredCount: filteredTokenGroups.length,
      requestedMints: options.mints.length,
    });
  }

  // Convert worklist to OhlcvWorkItem[]
  const workItems: OhlcvWorkItem[] = [];

  for (const tokenGroup of filteredTokenGroups) {
    if (!tokenGroup.mint || !tokenGroup.earliestAlertTime) {
      logger.warn('Token group missing required fields', {
        mint: tokenGroup.mint,
        hasEarliestAlertTime: !!tokenGroup.earliestAlertTime,
      });
      continue;
    }

    const alertTime = DateTime.fromISO(tokenGroup.earliestAlertTime);
    if (!alertTime.isValid) {
      logger.warn('Invalid alert time in token group', {
        mint: tokenGroup.mint,
        earliestAlertTime: tokenGroup.earliestAlertTime,
      });
      continue;
    }

    // Calculate fetch window based on alert time
    // Adjust post-window based on interval to ensure 5000 candles
    // For 1s: 5000 candles = 5000 seconds = ~83.3 minutes total
    //   - preWindowMinutes is in minutes, convert to seconds: preWindowSeconds = preWindowMinutes * 60
    //   - postWindowSeconds = 5000 - preWindowSeconds
    // For 1m: 5000 candles = 5000 minutes total, so postWindow = 5000 - preWindow
    // For 5m: 5000 candles = 25000 minutes total, so postWindow = 25000 - preWindow
    // For 15s: 5000 candles = 75000 seconds = 1250 minutes total, so postWindow = 1250 - preWindow
    // For 1H: 5000 candles = 5000 hours total, so postWindow = 5000 * 60 - preWindow
    let startTime: DateTime;
    let endTime: DateTime;

    if (interval === '1s') {
      // For 1s intervals, preWindowMinutes is actually treated as seconds offset
      // Default: 52 seconds before alert (standard offset)
      const preWindowSeconds =
        preWindowMinutes >= 0 ? preWindowMinutes : Math.abs(preWindowMinutes);
      const postWindowSeconds = 5000 - preWindowSeconds; // 5000 candles total
      startTime = alertTime.minus({ seconds: preWindowSeconds });
      endTime = alertTime.plus({ seconds: postWindowSeconds });
    } else {
      // For other intervals, use minutes
      let adjustedPostWindow = postWindowMinutes;
      if (interval === '1m') {
        adjustedPostWindow = 5000 - preWindowMinutes; // 5000 candles for 1m
      } else if (interval === '5m') {
        adjustedPostWindow = 25000 - preWindowMinutes; // 5000 candles for 5m
      } else if (interval === '15s') {
        adjustedPostWindow = 1250 - preWindowMinutes; // 5000 candles for 15s (1250 minutes)
      } else if (interval === '1H') {
        adjustedPostWindow = 5000 * 60 - preWindowMinutes; // 5000 candles for 1H (5000 hours = 300000 minutes)
      }
      startTime = alertTime.minus({ minutes: preWindowMinutes });
      endTime = alertTime.plus({ minutes: adjustedPostWindow });
    }

    // Use chain from token group, or fallback to options.chain
    // Normalize chain to lowercase
    const tokenChain = tokenGroup.chain ? (normalizeChain(tokenGroup.chain) as Chain) : chain;

    workItems.push({
      mint: tokenGroup.mint,
      chain: tokenChain,
      interval,
      startTime,
      endTime,
      priority: tokenGroup.callCount || 1, // Higher call count = higher priority
      alertTime,
      callCount: tokenGroup.callCount,
    });
  }

  // Sort by priority (higher call count first)
  workItems.sort((a, b) => (b.priority || 0) - (a.priority || 0));

  logger.info('Generated OHLCV worklist', {
    workItems: workItems.length,
    totalCalls: worklist.calls.length,
  });

  return workItems;
}
