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
