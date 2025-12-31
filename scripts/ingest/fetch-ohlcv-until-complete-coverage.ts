#!/usr/bin/env tsx
/**
 * Fetch OHLCV data until complete coverage is achieved
 * 
 * Coverage requirements:
 * - 1000 candles BEFORE alert
 * - At least 3000 candles AFTER alert
 * - For intervals: 1s, 1m, 5m
 * 
 * Continues fetching until close to 100% coverage
 */

import { DateTime } from 'luxon';
import { ingestOhlcv, createOhlcvIngestionContext } from '@quantbot/workflows';
import type { IngestOhlcvSpec } from '@quantbot/workflows';
import { getCoverage } from '@quantbot/ohlcv';
import { logger } from '@quantbot/utils';
import { DuckDBStorageService, PythonEngine } from '@quantbot/simulation';
import path from 'node:path';

interface Alert {
  mint: string;
  chain: string;
  alertTime: DateTime;
  alertId: string;
}

interface CoverageStatus {
  mint: string;
  chain: string;
  alertTime: DateTime;
  interval: '1s' | '1m' | '5m';
  candlesBefore: number;
  candlesAfter: number;
  hasEnoughBefore: boolean;
  hasEnoughAfter: boolean;
  needsFetch: boolean;
}

interface CoverageStats {
  total: number;
  complete: number;
  incomplete: number;
  byInterval: {
    '1s': { total: number; complete: number };
    '1m': { total: number; complete: number };
    '5m': { total: number; complete: number };
  };
}

const REQUIRED_CANDLES_BEFORE = 1000;
const REQUIRED_CANDLES_AFTER = 3000;
const INTERVALS: Array<'1s' | '1m' | '5m'> = ['1s', '1m', '5m'];
const TARGET_COVERAGE_PERCENT = 95; // Stop when we reach 95% coverage

/**
 * Calculate time windows for each interval
 */
function calculateTimeWindows(interval: '1s' | '1m' | '5m'): {
  beforeMinutes: number;
  afterMinutes: number;
} {
  const intervalSeconds = interval === '1s' ? 1 : interval === '1m' ? 60 : 300;
  
  // Calculate minutes needed for required candles
  const beforeSeconds = REQUIRED_CANDLES_BEFORE * intervalSeconds;
  const afterSeconds = REQUIRED_CANDLES_AFTER * intervalSeconds;
  
  // Add 20% buffer for safety
  const beforeMinutes = Math.ceil((beforeSeconds / 60) * 1.2);
  const afterMinutes = Math.ceil((afterSeconds / 60) * 1.2);
  
  return { beforeMinutes, afterMinutes };
}

/**
 * Query all alerts from DuckDB
 */
async function queryAllAlerts(duckdbPath: string): Promise<Alert[]> {
  const pythonEngine = new PythonEngine();
  const duckdbStorage = new DuckDBStorageService(pythonEngine);
  
  // Query with a large limit to get all alerts
  const result = await duckdbStorage.queryCalls(duckdbPath, 50000, false);
  
  if (!result.success || !result.calls) {
    throw new Error(`Failed to query alerts: ${result.error || 'Unknown error'}`);
  }
  
  // Deduplicate by mint + alert_timestamp
  const seen = new Set<string>();
  const alerts: Alert[] = [];
  
  for (const call of result.calls) {
    const key = `${call.mint}-${call.alert_timestamp}`;
    if (!seen.has(key)) {
      seen.add(key);
      alerts.push({
        mint: call.mint,
        chain: 'solana', // Default to solana
        alertTime: DateTime.fromISO(call.alert_timestamp),
        alertId: `${call.mint}-${call.alert_timestamp}`,
      });
    }
  }
  
  return alerts;
}

/**
 * Check coverage for a specific alert and interval
 */
async function checkCoverage(
  alert: Alert,
  interval: '1s' | '1m' | '5m'
): Promise<CoverageStatus> {
  const { beforeMinutes, afterMinutes } = calculateTimeWindows(interval);
  
  const beforeTime = alert.alertTime.minus({ minutes: beforeMinutes });
  const afterTime = alert.alertTime.plus({ minutes: afterMinutes });
  const now = DateTime.utc();
  
  let candlesBefore = 0;
  let candlesAfter = 0;
  
  try {
    const beforeEndTime = alert.alertTime.minus({ seconds: 1 });
    const beforeCoverage = await getCoverage(
      alert.mint,
      alert.chain as 'solana' | 'ethereum' | 'base' | 'bsc',
      beforeTime.toJSDate(),
      beforeEndTime.toJSDate(),
      interval
    );
    candlesBefore = beforeCoverage.candleCount;
    
    const afterStartTime = alert.alertTime;
    const endTime = afterTime < now ? afterTime : now;
    const afterCoverage = await getCoverage(
      alert.mint,
      alert.chain as 'solana' | 'ethereum' | 'base' | 'bsc',
      afterStartTime.toJSDate(),
      endTime.toJSDate(),
      interval
    );
    candlesAfter = afterCoverage.candleCount;
  } catch (error) {
    logger.warn(`Failed to check coverage for ${alert.mint}`, {
      interval,
      error: error instanceof Error ? error.message : String(error),
    });
    candlesBefore = 0;
    candlesAfter = 0;
  }
  
  const hasEnoughBefore = candlesBefore >= REQUIRED_CANDLES_BEFORE;
  const hasEnoughAfter = candlesAfter >= REQUIRED_CANDLES_AFTER;
  const needsFetch = !hasEnoughBefore || !hasEnoughAfter;
  
  return {
    mint: alert.mint,
    chain: alert.chain,
    alertTime: alert.alertTime,
    interval,
    candlesBefore,
    candlesAfter,
    hasEnoughBefore,
    hasEnoughAfter,
    needsFetch,
  };
}

/**
 * Fetch OHLCV for a specific alert and interval
 */
async function fetchOhlcvForAlert(
  alert: Alert,
  interval: '1s' | '1m' | '5m',
  duckdbPath: string
): Promise<{ success: boolean; candlesFetched: number; error?: string }> {
  const { beforeMinutes, afterMinutes } = calculateTimeWindows(interval);
  
  const fromTime = alert.alertTime.minus({ minutes: beforeMinutes });
  const afterTime = alert.alertTime.plus({ minutes: afterMinutes });
  const now = DateTime.utc();
  const toTime = afterTime < now ? afterTime : now;
  
  const workflowCtx = await createOhlcvIngestionContext({ duckdbPath });
  
  const spec: IngestOhlcvSpec = {
    duckdbPath,
    chain: alert.chain as 'solana' | 'ethereum' | 'base' | 'bsc',
    interval,
    from: fromTime.toISO()!,
    to: toTime.toISO()!,
    preWindowMinutes: beforeMinutes,
    postWindowMinutes: afterMinutes,
    side: 'buy',
    errorMode: 'collect',
    checkCoverage: true,
    rateLimitMs: 330,
    maxRetries: 3,
    mints: [alert.mint],
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
 * Calculate coverage statistics
 */
function calculateStats(statuses: CoverageStatus[]): CoverageStats {
  const byInterval = {
    '1s': { total: 0, complete: 0 },
    '1m': { total: 0, complete: 0 },
    '5m': { total: 0, complete: 0 },
  };
  
  let total = 0;
  let complete = 0;
  
  for (const status of statuses) {
    total++;
    byInterval[status.interval].total++;
    
    if (!status.needsFetch) {
      complete++;
      byInterval[status.interval].complete++;
    }
  }
  
  return {
    total,
    complete,
    incomplete: total - complete,
    byInterval,
  };
}

/**
 * Main execution
 */
async function main() {
  const duckdbPath = process.env.DUCKDB_PATH || 'data/tele.duckdb';
  const resolvedPath = path.resolve(duckdbPath);
  
  logger.info('Starting OHLCV coverage fetch', {
    duckdbPath: resolvedPath,
    requiredBefore: REQUIRED_CANDLES_BEFORE,
    requiredAfter: REQUIRED_CANDLES_AFTER,
    intervals: INTERVALS,
    targetCoverage: TARGET_COVERAGE_PERCENT,
  });
  
  logger.info('Querying alerts from DuckDB...');
  const alerts = await queryAllAlerts(resolvedPath);
  logger.info(`Found ${alerts.length} alerts`);
  
  let iteration = 0;
  let previousStats: CoverageStats | null = null;
  
  while (true) {
    iteration++;
    logger.info(`\n=== Iteration ${iteration} ===`);
    
    logger.info('Checking coverage...');
    const statuses: CoverageStatus[] = [];
    
    for (let i = 0; i < alerts.length; i++) {
      const alert = alerts[i]!;
      
      if ((i + 1) % 100 === 0) {
        logger.info(`Checked ${i + 1}/${alerts.length} alerts...`);
      }
      
      for (const interval of INTERVALS) {
        const status = await checkCoverage(alert, interval);
        statuses.push(status);
      }
      
      if (i < alerts.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    
    const stats = calculateStats(statuses);
    const coveragePercent = (stats.complete / stats.total) * 100;
    
    logger.info('Coverage Statistics:', {
      total: stats.total,
      complete: stats.complete,
      incomplete: stats.incomplete,
      coveragePercent: coveragePercent.toFixed(2),
      byInterval: {
        '1s': {
          total: stats.byInterval['1s'].total,
          complete: stats.byInterval['1s'].complete,
          percent: ((stats.byInterval['1s'].complete / stats.byInterval['1s'].total) * 100).toFixed(2),
        },
        '1m': {
          total: stats.byInterval['1m'].total,
          complete: stats.byInterval['1m'].complete,
          percent: ((stats.byInterval['1m'].complete / stats.byInterval['1m'].total) * 100).toFixed(2),
        },
        '5m': {
          total: stats.byInterval['5m'].total,
          complete: stats.byInterval['5m'].complete,
          percent: ((stats.byInterval['5m'].complete / stats.byInterval['5m'].total) * 100).toFixed(2),
        },
      },
    });
    
    if (coveragePercent >= TARGET_COVERAGE_PERCENT) {
      logger.info(`✅ Target coverage reached: ${coveragePercent.toFixed(2)}% >= ${TARGET_COVERAGE_PERCENT}%`);
      break;
    }
    
    if (previousStats && stats.complete === previousStats.complete) {
      logger.warn('No progress made in this iteration. Stopping.');
      break;
    }
    
    previousStats = stats;
    
    const needsFetch = statuses.filter((s) => s.needsFetch);
    logger.info(`Found ${needsFetch.length} alerts/intervals that need fetching`);
    
    if (needsFetch.length === 0) {
      logger.info('No more alerts need fetching');
      break;
    }
    
    logger.info('Fetching OHLCV data...');
    let fetched = 0;
    let failed = 0;
    
    for (let i = 0; i < needsFetch.length; i++) {
      const status = needsFetch[i]!;
      const alert = alerts.find((a) => a.mint === status.mint && a.alertTime.equals(status.alertTime));
      
      if (!alert) {
        logger.warn(`Alert not found for ${status.mint} at ${status.alertTime.toISO()}`);
        continue;
      }
      
      if ((i + 1) % 10 === 0) {
        logger.info(`Fetched ${i + 1}/${needsFetch.length}...`);
      }
      
      const result = await fetchOhlcvForAlert(alert, status.interval, resolvedPath);
      
      if (result.success) {
        fetched++;
        logger.debug(`Fetched ${result.candlesFetched} candles for ${alert.mint} (${status.interval})`);
      } else {
        failed++;
        logger.warn(`Failed to fetch for ${alert.mint} (${status.interval}): ${result.error}`);
      }
      
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    
    logger.info(`Fetch complete: ${fetched} succeeded, ${failed} failed`);
    logger.info('Waiting 5 seconds before next iteration...');
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  
  logger.info('\n=== Final Coverage Report ===');
  const finalStatuses: CoverageStatus[] = [];
  
  for (const alert of alerts) {
    for (const interval of INTERVALS) {
      const status = await checkCoverage(alert, interval);
      finalStatuses.push(status);
    }
  }
  
  const finalStats = calculateStats(finalStatuses);
  const finalCoveragePercent = (finalStats.complete / finalStats.total) * 100;
  
  logger.info('Final Coverage:', {
    total: finalStats.total,
    complete: finalStats.complete,
    incomplete: finalStats.incomplete,
    coveragePercent: finalCoveragePercent.toFixed(2),
    byInterval: {
      '1s': {
        total: finalStats.byInterval['1s'].total,
        complete: finalStats.byInterval['1s'].complete,
        percent: ((finalStats.byInterval['1s'].complete / finalStats.byInterval['1s'].total) * 100).toFixed(2),
      },
      '1m': {
        total: finalStats.byInterval['1m'].total,
        complete: finalStats.byInterval['1m'].complete,
        percent: ((finalStats.byInterval['1m'].complete / finalStats.byInterval['1m'].total) * 100).toFixed(2),
      },
      '5m': {
        total: finalStats.byInterval['5m'].total,
        complete: finalStats.byInterval['5m'].complete,
        percent: ((finalStats.byInterval['5m'].complete / finalStats.byInterval['5m'].total) * 100).toFixed(2),
      },
    },
  });
}

main().catch((error) => {
  logger.error('Fatal error', error);
  process.exit(1);
});
