/**
 * Run Backtest - Single linear orchestrator for CALLS
 *
 * The golden path:
 * 1. Plan: compute requirements per call
 * 2. Coverage: verify data exists for calls
 * 3. Slice: materialise dataset for calls
 * 4. Engine: execute backtest per call (pure)
 * 5. Report: persist results
 *
 * No alternative paths. One command, one flow.
 * Entry points come from calls, we optimize exit timing.
 */

import { randomUUID } from 'crypto';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import type { BacktestRequest, BacktestSummary } from './types.js';
import { planBacktest } from './plan.js';
import { checkCoverage } from './coverage.js';
import { materialiseSlice } from './slice.js';
import { backtestCall } from './engine/index.js';
import { emitReport } from './report.js';
import { logger } from '@quantbot/utils';
import type { Candle } from '@quantbot/core';
import { computePathMetrics } from './metrics/path-metrics.js';
import { DateTime } from 'luxon';

/**
 * Load candles from existing day-partitioned parquet files
 * Format: /path/to/ohlcv_candles_YYYY-MM-DD.parquet
 */
export async function loadCandlesFromExistingParquet(
  parquetBasePath: string,
  from: DateTime,
  to: DateTime,
  interval: string
): Promise<Map<string, Candle[]>> {
  const { openDuckDb } = await import('@quantbot/storage');
  const conn = await openDuckDb(':memory:');
  const candlesByCall = new Map<string, Candle[]>();

  // Build list of parquet files for date range
  const files: string[] = [];
  let current = from.startOf('day');
  const end = to.endOf('day');

  while (current <= end) {
    const dateStr = current.toFormat('yyyy-MM-dd');
    const filePath = `${parquetBasePath}/ohlcv_candles_${dateStr}.parquet`;
    // Check if file exists (best effort - DuckDB will error if missing)
    try {
      const { existsSync } = await import('fs');
      if (existsSync(filePath)) {
        files.push(filePath);
      }
    } catch {
      // Ignore - will try to read anyway
    }
    current = current.plus({ days: 1 });
  }

  if (files.length === 0) {
    return candlesByCall; // No files found
  }

  // Map interval string to seconds (UInt32 in ClickHouse)
  const intervalSeconds: Record<string, number> = {
    '1s': 1,
    '15s': 15,
    '1m': 60,
    '5m': 300,
    '15m': 900,
    '1h': 3600,
    '4h': 14400,
    '1d': 86400,
  };
  const intervalSec = intervalSeconds[interval] || 60;

  // Read all parquet files and filter by interval and time range
  const fileList = files.map((f) => `'${f.replace(/'/g, "''")}'`).join(', ');
  const fromUnix = Math.floor(from.toSeconds());
  const toUnix = Math.floor(to.toSeconds());

  const rows = await conn.all<{
    token_address: string;
    chain: string;
    timestamp: string; // DateTime from ClickHouse
    interval: number; // UInt32
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>(`
    SELECT 
      token_address,
      chain,
      timestamp,
      interval,
      open,
      high,
      low,
      close,
      volume
    FROM read_parquet([${fileList}])
    WHERE interval = ${intervalSec}
      AND toUnixTimestamp(timestamp) >= ${fromUnix}
      AND toUnixTimestamp(timestamp) <= ${toUnix}
    ORDER BY token_address, chain, timestamp
  `);

  // Return raw candles (will be matched to calls later)
  // Store by token_address:chain key for matching
  const candlesByToken = new Map<string, Candle[]>();
  for (const row of rows) {
    const key = `${row.token_address}:${row.chain}`;
    if (!candlesByToken.has(key)) {
      candlesByToken.set(key, []);
    }
    candlesByToken.get(key)!.push({
      timestamp: Math.floor(DateTime.fromISO(row.timestamp).toSeconds()),
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
    });
  }

  return candlesByToken as any; // Will be matched to calls in caller
}

/**
 * Load candles from slice (grouped by call_id)
 * Supports both single parquet file (with call_id) and existing day-partitioned files (without call_id)
 */
export async function loadCandlesFromSlice(
  slicePath: string | string[]
): Promise<Map<string, Candle[]>> {
}

/**
 * Run backtest - single linear orchestrator
 */
export async function runBacktest(req: BacktestRequest): Promise<BacktestSummary> {
  const runId = randomUUID();
  logger.info('Starting backtest', { runId, strategy: req.strategy.id, calls: req.calls.length });

  // Step 1: Plan
  const plan = planBacktest(req);
  logger.info('Planning complete', {
    totalRequiredCandles: plan.totalRequiredCandles,
    calls: req.calls.length,
  });

  // Step 2: Coverage gate
  const coverage = await checkCoverage(plan);
  if (coverage.eligible.length === 0) {
    throw new Error('No eligible calls after coverage check');
  }
  logger.info('Coverage check complete', {
    eligible: coverage.eligible.length,
    excluded: coverage.excluded.length,
  });

  // Step 3: Slice materialisation
  const slice = await materialiseSlice(plan, coverage);
  logger.info('Slice materialised', {
    path: slice.path,
    calls: slice.callIds.length,
  });

  // Step 4: Load candles from slice
  const candlesByCall = await loadCandlesFromSlice(slice.path);

  // Step 5: Execute backtest (pure) - per call
  const allTrades: Array<import('./types.js').Trade> = [];
  const allEvents: Array<import('./types.js').BacktestEvent> = [];

  // Create call lookup map
  const callsById = new Map(req.calls.map((call) => [call.id, call]));

  // Track trades by callId for path metrics
  const tradesByCallId = new Map<string, Array<import('./types.js').Trade>>();

  for (const eligible of coverage.eligible) {
    const call = callsById.get(eligible.callId);
    if (!call) {
      logger.warn('Call not found', { callId: eligible.callId });
      continue;
    }

    const candles = candlesByCall.get(eligible.callId) || [];

    if (candles.length === 0) {
      logger.warn('No candles found for call', { callId: eligible.callId });
      continue;
    }

    const result = await backtestCall(call, candles, req.strategy, plan.entryDelayCandles);
    allTrades.push(...result.trades);
    allEvents.push(...result.events);

    // Group trades by callId
    if (result.trades.length > 0) {
      if (!tradesByCallId.has(eligible.callId)) {
        tradesByCallId.set(eligible.callId, []);
      }
      tradesByCallId.get(eligible.callId)!.push(...result.trades);
    }
  }

  logger.info('Backtest execution complete', {
    totalTrades: allTrades.length,
    totalEvents: allEvents.length,
  });

  }

  // Step 7: Report (existing JSON artifacts)
  const summary = await emitReport(runId, allTrades, allEvents, coverage, req.strategy);

  return summary;
}
