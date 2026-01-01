/**
 * Slice Materialiser - Extract minimum viable dataset for CALLS
 *
 * One slice per run. Immutable after creation.
 * Backtest engine never touches ClickHouse.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { DateTime } from 'luxon';
import type { BacktestPlan, CoverageResult, Slice, Interval } from './types.js';
import { OhlcvRepository } from '@quantbot/storage';
import { logger } from '@quantbot/utils';

/**
 * Materialise slice - extract candles for eligible calls
 *
 * Creates one parquet file per run with all eligible calls.
 */
export async function materialiseSlice(
  plan: BacktestPlan,
  coverage: CoverageResult
): Promise<Slice> {
  const ohlcvRepo = new OhlcvRepository();
  const runId = randomUUID();

  // Determine interval string
  const intervalMap: Record<number, string> = {
    1: '1s',
    15: '15s',
    60: '1m',
    300: '5m',
    900: '15m',
    3600: '1h',
    14400: '4h',
    86400: '1d',
  };
  const interval = (intervalMap[plan.intervalSeconds] || '1m') as Interval;

  // Create slice directory
  const artifactsDir = join(process.cwd(), 'artifacts', 'backtest', runId);
  await fs.mkdir(artifactsDir, { recursive: true });

  const slicePath = join(artifactsDir, `slice_${interval}.parquet`);

  // Collect all candles for eligible calls
  const allCandles: Array<{
    call_id: string;
    token_address: string;
    chain: string;
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }> = [];

  // OPTIMIZATION: Single bulk ClickHouse query instead of N queries
  // Collect all unique tokens and time windows
  const tokenWindows = new Map<string, { minFrom: DateTime; maxTo: DateTime; callIds: string[] }>();
  
  for (const eligible of coverage.eligible) {
    const window = plan.perCallWindow.find((w) => w.callId === eligible.callId);
    if (!window) continue;
    
    const key = `${eligible.tokenAddress}:${eligible.chain}`;
    const existing = tokenWindows.get(key);
    
    if (existing) {
      existing.minFrom = window.from < existing.minFrom ? window.from : existing.minFrom;
      existing.maxTo = window.to > existing.maxTo ? window.to : existing.maxTo;
      existing.callIds.push(eligible.callId);
    } else {
      tokenWindows.set(key, {
        minFrom: window.from,
        maxTo: window.to,
        callIds: [eligible.callId],
      });
    }
  }

  // Single bulk query per token (much faster than N queries)
  for (const [key, { minFrom, maxTo, callIds }] of tokenWindows.entries()) {
    const [tokenAddress, chain] = key.split(':');
    
    try {
      const candles = await ohlcvRepo.getCandles(tokenAddress, chain, interval, {
        from: minFrom,
        to: maxTo,
      } as { from: DateTime; to: DateTime });

      // Map candles to calls based on their time windows
      for (const callId of callIds) {
        const window = plan.perCallWindow.find((w) => w.callId === callId);
        if (!window) continue;
        
        for (const candle of candles) {
          const candleTime = DateTime.fromSeconds(candle.timestamp);
          if (candleTime >= window.from && candleTime <= window.to) {
            allCandles.push({
              call_id: callId,
              token_address: tokenAddress,
              chain: chain,
              timestamp: candle.timestamp,
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              volume: candle.volume,
            });
          }
        }
      }
    } catch (error) {
      logger.warn('Error loading candles for token', {
        token: tokenAddress,
        callIds,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Write to parquet via DuckDB
  if (allCandles.length > 0) {
    // Use storage's DuckDB adapter
    const { openDuckDb } = await import('@quantbot/storage');
    const conn = await openDuckDb(':memory:');

    // Create table
    await conn.run(`
      CREATE TABLE candles (
        call_id VARCHAR,
        token_address VARCHAR,
        chain VARCHAR,
        timestamp BIGINT,
        open DOUBLE,
        high DOUBLE,
        low DOUBLE,
        close DOUBLE,
        volume DOUBLE
      )
    `);

    // Insert in batches
    const batchSize = 10000;
    for (let i = 0; i < allCandles.length; i += batchSize) {
      const batch = allCandles.slice(i, i + batchSize);
      for (const c of batch) {
        await conn.run(`INSERT INTO candles VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
          c.call_id,
          c.token_address,
          c.chain,
          c.timestamp,
          c.open,
          c.high,
          c.low,
          c.close,
          c.volume,
        ]);
      }
    }

    // Export to parquet
    await conn.run(`COPY candles TO '${slicePath}' (FORMAT PARQUET)`);
  }

  logger.info('Slice materialised', {
    path: slicePath,
    calls: coverage.eligible.length,
    candles: allCandles.length,
  });

  return {
    path: slicePath,
    format: 'parquet',
    interval,
    callIds: coverage.eligible.map((e) => e.callId),
  };
}
