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
