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
import { logger } from '@quantbot/infra/utils';
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
  // Use DuckDBClient (Python) for heavy data lifting
  const { DuckDBClient } = await import('@quantbot/storage');
  const client = new DuckDBClient(':memory:');
  const candlesByCall = new Map<string, Candle[]>();

  try {
    // Support both single file and multiple files (glob patterns or array)
    let parquetQuery: string;
    if (Array.isArray(slicePath)) {
      // Multiple files: use UNION ALL or list of files
      const fileList = slicePath.map((p) => `'${p.replace(/'/g, "''")}'`).join(', ');
      parquetQuery = `SELECT * FROM read_parquet([${fileList}])`;
    } else if (slicePath.includes('*') || slicePath.includes('?')) {
      // Glob pattern: DuckDB supports glob in read_parquet
      parquetQuery = `SELECT * FROM read_parquet('${slicePath.replace(/'/g, "''")}')`;
    } else {
      // Single file
      parquetQuery = `SELECT * FROM read_parquet('${slicePath.replace(/'/g, "''")}')`;
    }

    // Execute query via Python (heavy data lifting)
    const result = await client.query(parquetQuery);

    if (result.error) {
      throw new Error(`Failed to read parquet: ${result.error}`);
    }

    // Convert rows to structured format
    // DuckDB Python returns rows as arrays, columns as metadata
    const columnNames = result.columns.map((c) => c.name);
    const rows = result.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < columnNames.length; i++) {
        obj[columnNames[i]] = row[i];
      }
      return obj as {
        call_id?: string;
        token_address: string;
        chain: string;
        timestamp: number | string | bigint;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      };
    });

    // Group by call_id (if present) or return as-is
    for (const row of rows) {
      // Handle both formats: with call_id (from materialiseSlice) or without (from existing parquet)
      if (row.call_id) {
        // Materialised slice format (has call_id)
        if (!candlesByCall.has(row.call_id)) {
          candlesByCall.set(row.call_id, []);
        }

        // Handle BigInt timestamps from DuckDB
        let timestamp: number;
        if (typeof row.timestamp === 'bigint') {
          timestamp = Number(row.timestamp);
        } else if (typeof row.timestamp === 'string') {
          timestamp = Math.floor(DateTime.fromISO(row.timestamp).toSeconds());
        } else {
          timestamp = row.timestamp;
        }

        candlesByCall.get(row.call_id)!.push({
          timestamp,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          volume: row.volume,
        });
      } else {
        // Existing parquet format (no call_id) - return as token:chain map
        // This case is handled by loadCandlesFromExistingParquet
        const key = `${row.token_address}:${row.chain}`;
        if (!candlesByCall.has(key)) {
          candlesByCall.set(key, []);
        }

        // Handle BigInt timestamps from DuckDB
        let timestamp: number;
        if (typeof row.timestamp === 'bigint') {
          timestamp = Number(row.timestamp);
        } else if (typeof row.timestamp === 'string') {
          timestamp = Math.floor(DateTime.fromISO(row.timestamp).toSeconds());
        } else {
          timestamp = row.timestamp;
        }

        candlesByCall.get(key)!.push({
          timestamp,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          volume: row.volume,
        });
      }
    }

    // Sort candles by timestamp
    for (const [callId, candles] of candlesByCall.entries()) {
      candles.sort((a, b) => a.timestamp - b.timestamp);
    }

    return candlesByCall;
  } finally {
    // Clean up Python connection
    await client.close();
  }
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

  // Step 6: Compute path metrics and write directly to Parquet (no DuckDB intermediate)
  const artifactsDir = join(process.cwd(), 'artifacts', 'backtest', runId);
  await mkdir(artifactsDir, { recursive: true });

  // Compute path metrics per call and prepare rows
  const rows: Array<Record<string, unknown>> = [];
  const positionUsd = req.strategy.position.notionalUsd;

  for (const eligible of coverage.eligible) {
    const call = callsById.get(eligible.callId);
    if (!call) continue;

    const callId = eligible.callId;
    const candles = candlesByCall.get(callId) || [];

    if (candles.length === 0) continue;

    // Anchor time: ALERT timestamp (ms)
    const t0_ms = call.createdAt.toMillis();

    // Compute path metrics
    const path = computePathMetrics(candles, t0_ms, {
      activity_move_pct: 0.1, // 10% move threshold for activity
    });

    // Get trades for this call (use first trade if multiple)
    const trades = tradesByCallId.get(callId) || [];

    // If no trade happened, skip (or store path metrics only - user's choice)
    if (trades.length === 0) {
      continue;
    }

    // Use first trade (per call)
    const trade = trades[0];

    // Calculate return and PnL
    const return_bps = trade.pnl.netReturnPct * 100; // pct -> bps
    const pnl_usd = (trade.pnl.netReturnPct / 100) * positionUsd;

    rows.push({
      run_id: runId,
      call_id: callId,
      caller_name: trade.caller,
      mint: trade.tokenAddress,
      interval: req.interval,

      entry_ts_ms: trade.entry.tsMs,
      exit_ts_ms: trade.exit.tsMs,
      entry_px: trade.entry.px,
      exit_px: trade.exit.px,

      return_bps,
      pnl_usd,

      hold_ms: trade.exit.tsMs - trade.entry.tsMs,
      exit_reason: trade.exit.reason ?? null,

      // Path metrics
      t0_ms: path.t0_ms,
      p0: isFinite(path.p0) ? path.p0 : null,

      hit_2x: path.hit_2x,
      t_2x_ms: path.t_2x_ms,
      hit_3x: path.hit_3x,
      t_3x_ms: path.t_3x_ms,
      hit_4x: path.hit_4x,
      t_4x_ms: path.t_4x_ms,

      dd_bps: path.dd_bps,
      dd_to_2x_bps: path.dd_to_2x_bps,
      alert_to_activity_ms: path.alert_to_activity_ms,
      peak_multiple: path.peak_multiple,
    });
  }

  // Write directly to Parquet and submit to bus (no DuckDB intermediate)
  if (rows.length > 0) {
    try {
      const { writeBacktestResults } = await import('./bus-integration.js');
      await writeBacktestResults({
        runId,
        artifactsDir,
        backtestType: 'full',
        data: rows,
        tableName: 'backtest_call_results',
        metadata: {
          interval: req.interval,
          strategy: req.strategy.name || 'unknown',
          callsProcessed: coverage.eligible.length,
          rowsWritten: rows.length,
          totalTrades: allTrades.length,
          totalEvents: allEvents.length,
        },
      });
      logger.info('Backtest results written to Parquet and submitted to bus', {
        rows: rows.length,
        artifactsDir,
      });
    } catch (error) {
      // Don't fail if bus submission fails
      logger.warn('Failed to write backtest results to bus', {
        runId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Step 7: Report (existing JSON artifacts)
  const summary = await emitReport(runId, allTrades, allEvents, coverage, req.strategy);

  return summary;
}
