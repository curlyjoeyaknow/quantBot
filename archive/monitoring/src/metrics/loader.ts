/**
 * Call Data Loader
 * ================
 * Load call performance data from Postgres.
 * Enrich with ATH from OHLCV cache.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import type { CallPerformance } from './types';
import { metricsEngine } from './metrics-engine';

const CACHE_DIR = process.env.OHLCV_CACHE_DIR || path.join(process.cwd(), 'data', 'cache');

/**
 * Load calls from Postgres alerts table
 * Joins with tokens and callers for full context
 */
export async function loadCallsFromCallerDb(): Promise<CallPerformance[]> {
  try {
    // Dynamic import to avoid circular deps
    const { queryPostgres, closePostgresPool } =
      await import('../../../storage/src/postgres/postgres-client');

    const query = `
      SELECT 
        a.id,
        t.address as token_address,
        t.symbol as token_symbol,
        t.chain,
        c.handle as caller_name,
        c.source as caller_source,
        a.alert_timestamp,
        a.alert_price
      FROM alerts a
      JOIN tokens t ON a.token_id = t.id
      LEFT JOIN callers c ON a.caller_id = c.id
      ORDER BY a.alert_timestamp DESC
      LIMIT 10000
    `;

    const result = await queryPostgres<{
      id: number;
      token_address: string;
      token_symbol: string | null;
      chain: string;
      caller_name: string | null;
      caller_source: string | null;
      alert_timestamp: Date;
      alert_price: string | null;
    }>(query);

    const calls: CallPerformance[] = result.rows.map((row) => {
      const entryPrice = row.alert_price ? parseFloat(row.alert_price) : 1;
      const callerName = row.caller_name
        ? row.caller_source
          ? `${row.caller_source}/${row.caller_name}`
          : row.caller_name
        : 'unknown';

      return {
        callId: row.id,
        tokenAddress: row.token_address,
        tokenSymbol: row.token_symbol ?? undefined,
        callerName,
        chain: row.chain || 'solana',
        alertTimestamp: new Date(row.alert_timestamp),
        entryPrice,
        athPrice: entryPrice, // Will be enriched by simulation results
        athMultiple: 1,
        timeToAthMinutes: 0,
      };
    });

    logger.info(`Loaded ${calls.length} calls from Postgres`);
    return calls;
  } catch (error: any) {
    logger.error('Failed to load calls from Postgres', error);
    return [];
  }
}

/**
 * Find OHLCV cache file for a token
 */
function findCacheFile(chain: string, tokenAddress: string): string | null {
  try {
    const files = fs.readdirSync(CACHE_DIR);
    const prefix = `${chain}_${tokenAddress}_`;
    const match = files.find((f) => f.startsWith(prefix) && f.endsWith('.csv'));
    return match ? path.join(CACHE_DIR, match) : null;
  } catch {
    return null;
  }
}

/**
 * Parse CSV candle file
 */
function parseCandleCSV(
  filePath: string
): Array<{ timestamp: number; high: number; close: number }> {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');

    // Skip header: timestamp,open,high,low,close,volume
    return lines
      .slice(1)
      .map((line) => {
        const parts = line.split(',');
        return {
          timestamp: parseInt(parts[0], 10),
          high: parseFloat(parts[2]),
          close: parseFloat(parts[4]),
        };
      })
      .filter((c) => !isNaN(c.timestamp) && !isNaN(c.high) && !isNaN(c.close));
  } catch {
    return [];
  }
}

/**
 * Enrich calls with ATH from OHLCV cache
 */
export async function enrichCallsWithSimResults(
  calls: CallPerformance[]
): Promise<CallPerformance[]> {
  let enriched = 0;
  let skipped = 0;

  for (const call of calls) {
    const cacheFile = findCacheFile(call.chain, call.tokenAddress);
    if (!cacheFile) {
      skipped++;
      continue;
    }

    const candles = parseCandleCSV(cacheFile);
    if (candles.length === 0) {
      skipped++;
      continue;
    }

    const entryTs = Math.floor(call.alertTimestamp.getTime() / 1000);

    // Find entry price from candles if not set or 0
    let entryPrice = call.entryPrice;
    if (!entryPrice || entryPrice <= 0) {
      // Use first candle close after alert time as entry price
      const entryCandle = candles.find((c) => c.timestamp >= entryTs);
      if (entryCandle) {
        entryPrice = entryCandle.close;
      }
    }

    if (!entryPrice || entryPrice <= 0) {
      skipped++;
      continue;
    }

    const { athPrice, athMultiple, timeToAthMinutes } = calculateAthFromCandles(
      entryPrice,
      entryTs,
      candles
    );

    // Sanity check: cap multiples at 10000x to filter data issues
    if (athMultiple > 10000) {
      skipped++;
      continue;
    }

    call.entryPrice = entryPrice;
    call.athPrice = athPrice;
    call.athMultiple = athMultiple;
    call.timeToAthMinutes = timeToAthMinutes;
    enriched++;
  }

  logger.info(`Enriched ${enriched} calls with ATH data (${skipped} skipped, no cache)`);
  return calls;
}

/**
 * Load and populate metrics engine from databases
 */
export async function loadMetricsFromDatabases(): Promise<void> {
  logger.info('Loading metrics from databases...');

  try {
    const calls = await loadCallsFromCallerDb();
    const enriched = await enrichCallsWithSimResults(calls);

    metricsEngine.recordCalls(enriched);

    logger.info(`Metrics engine populated with ${enriched.length} calls`);
  } catch (error: any) {
    logger.error('Failed to load metrics from databases', error);
  }
}

/**
 * Calculate ATH from OHLCV candles
 */
export function calculateAthFromCandles(
  entryPrice: number,
  entryTimestamp: number,
  candles: Array<{ timestamp: number; high: number }>
): { athPrice: number; athMultiple: number; timeToAthMinutes: number } {
  let athPrice = entryPrice;
  let athTimestamp = entryTimestamp;

  for (const candle of candles) {
    if (candle.timestamp > entryTimestamp && candle.high > athPrice) {
      athPrice = candle.high;
      athTimestamp = candle.timestamp;
    }
  }

  const athMultiple = athPrice / entryPrice;
  const timeToAthMinutes = (athTimestamp - entryTimestamp) / 60;

  return { athPrice, athMultiple, timeToAthMinutes };
}

/**
 * Check data coverage for alerts
 */
export async function checkDataCoverage(): Promise<{
  totalCached: number;
  has5mData: number;
  has1mData: number;
  has52PeriodLookback: number;
  missing52PeriodLookback: number;
  noCache: number;
}> {
  try {
    const { queryPostgres } = await import('../../../storage/src/postgres/postgres-client');

    // Get alerts with token addresses
    const result = await queryPostgres<{
      address: string;
      alert_timestamp: Date;
    }>(`
      SELECT t.address, a.alert_timestamp
      FROM alerts a
      JOIN tokens t ON a.token_id = t.id
      WHERE t.chain = 'solana'
      ORDER BY a.alert_timestamp DESC
      LIMIT 1000
    `);

    // Count cache files
    const cacheFiles = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.csv'));
    const totalCached = cacheFiles.length;

    let has52PeriodLookback = 0;
    let missing52PeriodLookback = 0;
    let noCache = 0;
    let has5mData = 0;
    let has1mData = 0;

    for (const row of result.rows) {
      const prefix = 'solana_' + row.address + '_';
      const files = cacheFiles.filter((f) => f.startsWith(prefix));

      if (files.length === 0) {
        noCache++;
        continue;
      }

      // Check interval and lookback
      const filePath = path.join(CACHE_DIR, files[0]);
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n').slice(1);

      if (lines.length < 2) {
        noCache++;
        continue;
      }

      // Check interval
      const ts1 = parseInt(lines[0].split(',')[0]);
      const ts2 = parseInt(lines[1].split(',')[0]);
      const interval = ts2 - ts1;

      if (interval <= 60) has1mData++;
      else if (interval <= 300) has5mData++;

      // Check 52-period lookback (5m = 260 minutes)
      const firstTs = ts1 * 1000;
      const alertTs = new Date(row.alert_timestamp).getTime();
      const lookbackNeeded = 52 * 5 * 60 * 1000;

      if (firstTs <= alertTs - lookbackNeeded) {
        has52PeriodLookback++;
      } else {
        missing52PeriodLookback++;
      }
    }

    return {
      totalCached,
      has5mData,
      has1mData,
      has52PeriodLookback,
      missing52PeriodLookback,
      noCache,
    };
  } catch (error: any) {
    logger.error('Failed to check data coverage', error);
    return {
      totalCached: 0,
      has5mData: 0,
      has1mData: 0,
      has52PeriodLookback: 0,
      missing52PeriodLookback: 0,
      noCache: 0,
    };
  }
}

/**
 * Process simulation result and record call performance
 */
export function recordSimulationResult(
  callId: number,
  tokenAddress: string,
  tokenSymbol: string | undefined,
  callerName: string,
  chain: string,
  alertTimestamp: Date,
  entryPrice: number,
  candles: Array<{ timestamp: number; high: number }>
): void {
  const entryTs = Math.floor(alertTimestamp.getTime() / 1000);
  const { athPrice, athMultiple, timeToAthMinutes } = calculateAthFromCandles(
    entryPrice,
    entryTs,
    candles
  );

  metricsEngine.recordCall({
    callId,
    tokenAddress,
    tokenSymbol,
    callerName,
    chain,
    alertTimestamp,
    entryPrice,
    athPrice,
    athMultiple,
    timeToAthMinutes,
  });

  metricsEngine.recordSimulations(1);
}
