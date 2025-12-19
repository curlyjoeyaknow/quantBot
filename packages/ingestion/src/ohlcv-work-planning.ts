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

import { DateTime } from 'luxon';
import type { Chain } from '@quantbot/core';
import { logger, getPythonEngine } from '@quantbot/utils';

/**
 * Work item for OHLCV fetching
 */
export interface OhlcvWorkItem {
  mint: string;
  chain: Chain;
  interval: '15s' | '1m' | '5m' | '1H';
  startTime: DateTime;
  endTime: DateTime;
  priority?: number;
  alertTime?: DateTime; // Original alert time for context
  callCount?: number; // Number of calls for this mint
}

/**
 * Options for generating worklist
 */
export interface WorklistOptions {
  from?: Date;
  to?: Date;
  side?: 'buy' | 'sell';
  chain?: Chain;
  interval?: '15s' | '1m' | '5m' | '1H';
  preWindowMinutes?: number; // Minutes before alert to start fetching
  postWindowMinutes?: number; // Minutes after alert to end fetching
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
    chain = 'solana',
    interval = '1m',
    preWindowMinutes = 260, // Default: 260 minutes (52 * 5m) before alert
    postWindowMinutes = 1440, // Default: 1440 minutes (24h) after alert
  } = options;

  logger.info('Generating OHLCV worklist from DuckDB', {
    duckdbPath,
    from: from?.toISOString(),
    to: to?.toISOString(),
    side,
    chain,
    interval,
  });

  const pythonEngine = getPythonEngine();

  // Query DuckDB for worklist
  const worklist = await pythonEngine.runOhlcvWorklist({
    duckdbPath,
    from: from?.toISOString(),
    to: to?.toISOString(),
    side,
  });

  logger.info('Found worklist from DuckDB', {
    tokenGroups: worklist.tokenGroups.length,
    calls: worklist.calls.length,
  });

  // Convert worklist to OhlcvWorkItem[]
  const workItems: OhlcvWorkItem[] = [];

  for (const tokenGroup of worklist.tokenGroups) {
    if (!tokenGroup.mint || !tokenGroup.earliestAlertTime) {
      logger.warn('Token group missing required fields', {
        mint: tokenGroup.mint?.substring(0, 20),
        hasEarliestAlertTime: !!tokenGroup.earliestAlertTime,
      });
      continue;
    }

    const alertTime = DateTime.fromISO(tokenGroup.earliestAlertTime);
    if (!alertTime.isValid) {
      logger.warn('Invalid alert time in token group', {
        mint: tokenGroup.mint.substring(0, 20),
        earliestAlertTime: tokenGroup.earliestAlertTime,
      });
      continue;
    }

    // Calculate fetch window based on alert time
    const startTime = alertTime.minus({ minutes: preWindowMinutes });
    const endTime = alertTime.plus({ minutes: postWindowMinutes });

    // Use chain from token group, or fallback to options.chain
    const tokenChain = (tokenGroup.chain as Chain) || chain;

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

