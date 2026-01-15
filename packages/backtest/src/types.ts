/**
 * MVB Types - Core data structures for CALL-based backtesting
 *
 * Deterministic, pure types. No I/O, no side effects.
 *
 * KEY: This backtester works with CALLS, not arbitrary tokens.
 * Entry points come from calls, we optimize exit timing.
 */

import type { Candle, TokenAddress, Chain } from '@quantbot/core';
import type { DateTime } from 'luxon';

// Re-export types for convenience
export type { TokenAddress, Chain, Candle } from '@quantbot/core';
export type { DateTime } from 'luxon';

/**
 * Call record (from DuckDB)
 */
export interface CallRecord {
  id: string;
  caller: string;
  mint: TokenAddress;
  createdAt: DateTime; // Alert timestamp
}

/**
 * Strategy V1 - Simplified strategy definition
 */
export interface StrategyV1 {
  id: string;
  name: string;
  overlays: ExitOverlay[];
  fees: FeeModel;
  position: PositionModel;
  // Indicator requirements
  indicatorWarmup?: number; // candles needed for warmup
  entryDelay?: number; // candles to wait after call before entry
  maxHold?: number; // max candles to hold position
}

/**
 * Exit overlay (from simulation package)
 */
export type ExitOverlay =
  | { kind: 'time_exit'; holdMs: number }
  | { kind: 'stop_loss'; stopPct: number }
  | { kind: 'take_profit'; takePct: number }
  | { kind: 'trailing_stop'; trailPct: number }
  | { kind: 'combo'; legs: ExitOverlay[] };

/**
 * Fee model
 */
export interface FeeModel {
  takerFeeBps: number; // e.g., 30 = 0.30%
  slippageBps: number; // Constant slippage
}

/**
 * Position model
 */
export interface PositionModel {
  notionalUsd: number;
}

/**
 * Backtest request (input) - CALL-based
 */
export interface BacktestRequest {
  strategy: StrategyV1;
  calls: CallRecord[]; // Calls to backtest (not arbitrary tokens!)
  interval: Interval;
  from: DateTime; // Overall date range for coverage check
  to: DateTime;
}

/**
 * Interval type
 */
export type Interval = '1s' | '15s' | '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

/**
 * Backtest plan (output from planner)
 * Per-call windows based on call timestamps
 */
export interface BacktestPlan {
  intervalSeconds: number;
  indicatorWarmupCandles: number;
  entryDelayCandles: number;
  maxHoldCandles: number;
  totalRequiredCandles: number;
  perCallWindow: Array<{
    callId: string;
    tokenAddress: TokenAddress;
    chain: Chain;
    callTimestamp: DateTime; // Entry point from call
    from: DateTime; // Window start (call - warmup)
    to: DateTime; // Window end (call + maxHold)
  }>;
}

/**
 * Coverage result
 */
export interface CoverageResult {
  eligible: Array<{
    callId: string;
    tokenAddress: TokenAddress;
    chain: Chain;
  }>;
  excluded: Array<{
    callId: string;
    tokenAddress: TokenAddress;
    chain: Chain;
    reason: 'too_new' | 'missing_range' | 'missing_interval';
  }>;
}

/**
 * Slice (materialized data)
 */
export interface Slice {
  path: string;
  format: 'parquet';
  interval: Interval;
  callIds: string[];
}

/**
 * Trade result (per call)
 */
export interface Trade {
  callId: string;
  tokenAddress: TokenAddress;
  chain: Chain;
  caller: string;
  entry: { tsMs: number; px: number };
  exit: { tsMs: number; px: number; reason: string };
  pnl: {
    grossReturnPct: number;
    netReturnPct: number;
    feesUsd: number;
    slippageUsd: number;
  };
}

/**
 * Backtest event (for replay)
 */
export interface BacktestEvent {
  timestamp: number;
  callId: string;
  tokenAddress: TokenAddress;
  price: number;
  event: string;
  position?: {
    size: number;
    entryPrice: number;
    unrealizedPnl: number;
  };
}

/**
 * Backtest result (output from engine)
 */
export interface BacktestResult {
  trades: Trade[];
  events: BacktestEvent[];
}

/**
 * Backtest summary
 */
export interface BacktestSummary {
  runId: string;
  callsTested: number;
  callsExcluded: number;
  totalTrades: number;
  pnlPct: number;
  maxDrawdownPct: number;
  winRate: number;
  avgReturnPct: number;
}

// =============================================================================
// Path Metrics Types (Truth Layer - Guardrail 1)
// =============================================================================

/**
 * Path metrics row for DuckDB (1 row per eligible call, always)
 * This is the TRUTH LAYER - split from policy outcomes
 */
export interface PathMetricsRow {
  run_id: string;
  call_id: string;
  caller_name: string;
  mint: string;
  chain: string;
  interval: string;

  // Anchor
  alert_ts_ms: number; // t0_ms
  p0: number; // anchor price

  // Multiples
  hit_2x: boolean;
  t_2x_ms: number | null;
  hit_3x: boolean;
  t_3x_ms: number | null;
  hit_4x: boolean;
  t_4x_ms: number | null;

  // Drawdown (bps, negative = bad)
  dd_bps: number | null;
  dd_to_2x_bps: number | null;

  // Activity
  alert_to_activity_ms: number | null;

  // Summary
  peak_multiple: number | null;
}

/**
 * Policy result row for DuckDB (policy execution outcomes)
 * This is the POLICY LAYER - only written when trades execute
 */
export interface PolicyResultRow {
  run_id: string;
  policy_id: string;
  call_id: string;

  // Policy execution outcomes
  realized_return_bps: number;
  stop_out: boolean;
  max_adverse_excursion_bps: number;
  time_exposed_ms: number;
  tail_capture: number | null; // realized / peak_multiple

  // Entry/exit details
  entry_ts_ms: number;
  exit_ts_ms: number;
  entry_px: number;
  exit_px: number;
  exit_reason: string | null;
}

// =============================================================================
// Path-Only Mode Types (Guardrail 2)
// =============================================================================

/**
 * Path-only backtest request
 * Used for computing path metrics without policy execution
 */
export interface PathOnlyRequest {
  calls: CallRecord[];
  interval: Interval;
  from: DateTime;
  to: DateTime;
  activityMovePct?: number; // default 0.1 (10%)
}

/**
 * Path-only backtest summary
 */
export interface PathOnlySummary {
  runId: string;
  callsProcessed: number;
  callsExcluded: number;
  pathMetricsWritten: number;
}

// =============================================================================
// Caller Truth Leaderboard Types (Phase 3)
// =============================================================================

/**
 * Caller truth leaderboard row (from path metrics only)
 */
export interface CallerTruthLeaderboardRow {
  caller_name: string;
  calls: number;

  // Hit rates
  p_hit_2x: number;
  p_hit_3x: number;
  p_hit_4x: number;
  count_2x: number;
  count_3x: number;
  count_4x: number;
  failures_2x: number; // never hit 2x

  // Time metrics (in minutes for display)
  median_t2x_min: number | null;
  median_t3x_min: number | null;
  median_t4x_min: number | null;
  median_alert_to_activity_s: number | null;

  // Peak metrics
  median_peak_multiple: number | null;
  avg_peak_multiple: number | null;

  // Drawdown metrics
  median_dd_bps: number | null;
  p95_dd_bps: number | null;
  median_dd_to_2x_bps: number | null;
  p95_dd_to_2x_bps: number | null;

  // Slow/no activity rate
  slow_activity_rate: number; // % with alert_to_activity_ms > threshold
}
