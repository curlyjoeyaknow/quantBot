/**
 * Capital-Aware Simulator (V1 Baseline Optimizer)
 *
 * Simulates trading with finite capital, position constraints, and path-dependent capital management.
 *
 * Key features:
 * - Initial capital: C₀ = 10,000
 * - Capital is finite and path-dependent
 * - Capital tied in open positions is unavailable
 * - Max allocation per trade: 4% of free cash
 * - Max risk per trade: $200
 * - Max concurrent positions: 25
 * - Position sizing: min(size_risk, size_alloc, free_cash)
 * - Trade lifecycle: TP at tp_mult, SL at sl_mult, Time exit at 48h
 * - Objective: maximize final capital (C_final)
 */

import type { Candle } from '@quantbot/core';
import type { CallRecord } from '../types.js';

// =============================================================================
// Types
// =============================================================================

/**
 * V1 Baseline optimizer parameters
 */
export interface V1BaselineParams {
  /** Take-profit multiple (e.g., 2.0 = 2x) */
  tp_mult: number;
  /** Stop-loss multiple (e.g., 0.85 = -15%) */
  sl_mult: number;
  /** Optional max hold hours (≤ 48, defaults to 48) */
  max_hold_hrs?: number;
}

/**
 * Position in the simulation
 */
export interface Position {
  /** Call ID */
  callId: string;
  /** Token mint address */
  mint: string;
  /** Caller name */
  caller: string;
  /** Entry timestamp (ms) */
  entryTsMs: number;
  /** Entry price */
  entryPx: number;
  /** Position size (USD) */
  size: number;
  /** Take-profit price */
  tpPrice: number;
  /** Stop-loss price */
  slPrice: number;
  /** Max hold timestamp (ms) */
  maxHoldTsMs: number;
}

/**
 * Trade execution result
 */
export interface TradeExecution {
  /** Call ID */
  callId: string;
  /** Entry timestamp (ms) */
  entryTsMs: number;
  /** Exit timestamp (ms) */
  exitTsMs: number;
  /** Entry price */
  entryPx: number;
  /** Exit price */
  exitPx: number;
  /** Position size (USD) */
  size: number;
  /** PnL (USD) */
  pnl: number;
  /** Exit reason */
  exitReason: 'take_profit' | 'stop_loss' | 'time_exit' | 'no_entry' | 'insufficient_capital';
  /** Return multiple (exit_mult) */
  exitMult: number;
}

/**
 * Capital state during simulation
 */
export interface CapitalState {
  /** Initial capital */
  initialCapital: number;
  /** Current free cash (available for new positions) */
  freeCash: number;
  /** Total capital (free cash + unrealized PnL) */
  totalCapital: number;
  /** Open positions */
  positions: Map<string, Position>;
  /** Completed trades */
  completedTrades: TradeExecution[];
}

/**
 * Capital simulation result
 */
export interface CapitalSimulationResult {
  /** Final capital */
  finalCapital: number;
  /** Total return (as decimal, e.g., 0.25 = 25%) */
  totalReturn: number;
  /** Number of trades executed */
  tradesExecuted: number;
  /** Number of trades skipped (insufficient capital) */
  tradesSkipped: number;
  /** All completed trades */
  completedTrades: TradeExecution[];
  /** Capital state at end */
  finalState: CapitalState;
}

/**
 * Configuration for capital simulator
 */
export interface CapitalSimulatorConfig {
  /** Initial capital (default: 10,000) */
  initialCapital?: number;
  /** Max allocation per trade as fraction of free cash (default: 0.04 = 4%) */
  maxAllocationPct?: number;
  /** Max risk per trade in USD (default: 200) */
  maxRiskPerTrade?: number;
  /** Max concurrent positions (default: 25) */
  maxConcurrentPositions?: number;
  /** Max trade horizon in hours (default: 48) */
  maxTradeHorizonHrs?: number;
  /** Minimum executable size in USD (default: 10) */
  minExecutableSize?: number;
  /** Fee structure */
  fees?: {
    takerFeeBps: number;
    slippageBps: number;
  };
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_CONFIG: Required<CapitalSimulatorConfig> = {
  initialCapital: 10_000,
  maxAllocationPct: 0.04,
  maxRiskPerTrade: 200,
  maxConcurrentPositions: 25,
  maxTradeHorizonHrs: 48,
  minExecutableSize: 10,
  fees: {
    takerFeeBps: 30,
    slippageBps: 10,
  },
};

// =============================================================================
// Capital Simulator
// =============================================================================

/**
 * Simulate capital-aware trading over a sequence of alerts
 *
 * Processes alerts in timestamp order and executes trades with position constraints.
 */
export function simulateCapitalAware(
  calls: CallRecord[],
  candlesByCallId: Map<string, Candle[]>,
  params: V1BaselineParams,
  config: CapitalSimulatorConfig = {}
): CapitalSimulationResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const maxHoldHrs = params.max_hold_hrs ?? cfg.maxTradeHorizonHrs;

  // Sort calls by timestamp
  const sortedCalls = [...calls].sort((a, b) => {
    const aMs = a.createdAt.toMillis();
    const bMs = b.createdAt.toMillis();
    return aMs - bMs;
  });

  // Initialize capital state
  const state: CapitalState = {
    initialCapital: cfg.initialCapital,
    freeCash: cfg.initialCapital,
    totalCapital: cfg.initialCapital,
    positions: new Map(),
    completedTrades: [],
  };

  // Process alerts in timestamp order
  for (const call of sortedCalls) {
    const alertTsMs = call.createdAt.toMillis();

    // First, check for any positions that should exit before this alert
    checkAndExecuteExits(state, candlesByCallId, alertTsMs, cfg);

    // Check if we can take a new position
    if (state.positions.size >= cfg.maxConcurrentPositions) {
      continue; // Skip - max positions reached
    }

    const candles = candlesByCallId.get(call.id);
    if (!candles || candles.length === 0) {
      continue;
    }

    // Calculate position size
    const positionSize = calculatePositionSize(
      params.sl_mult,
      cfg.maxRiskPerTrade,
      cfg.maxAllocationPct,
      state.freeCash
    );

    // Check minimum executable size
    if (positionSize < cfg.minExecutableSize) {
      continue; // Skip - size too small
    }

    // Check if we have enough capital
    if (positionSize > state.freeCash) {
      continue; // Skip - insufficient capital
    }

    // Execute entry
    const entryResult = executeEntry(
      state,
      call,
      candles,
      params,
      positionSize,
      maxHoldHrs,
      alertTsMs,
      cfg
    );

    if (entryResult) {
      state.positions.set(call.id, entryResult.position);
    }
  }

  // Process remaining open positions at end
  // Use a large timestamp to force all exits
  checkAndExecuteExits(state, candlesByCallId, Number.MAX_SAFE_INTEGER, cfg);

  // Final capital update (all positions should be closed now)
  state.totalCapital = state.freeCash;

  // Calculate final metrics
  const totalReturn = (state.totalCapital - cfg.initialCapital) / cfg.initialCapital;
  const tradesExecuted = state.completedTrades.filter((t) => t.exitReason !== 'no_entry' && t.exitReason !== 'insufficient_capital').length;
  const tradesSkipped = state.completedTrades.filter((t) => t.exitReason === 'insufficient_capital').length;

  return {
    finalCapital: state.totalCapital,
    totalReturn,
    tradesExecuted,
    tradesSkipped,
    completedTrades: state.completedTrades,
    finalState: state,
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Calculate position size based on risk and allocation constraints
 *
 * size_risk = max_risk / sl_frac
 * size_alloc = max_alloc_pct * free_cash
 * size = min(size_risk, size_alloc, free_cash)
 */
function calculatePositionSize(
  sl_mult: number,
  maxRiskPerTrade: number,
  maxAllocationPct: number,
  freeCash: number
): number {
  const sl_frac = 1 - sl_mult; // e.g., 0.85 -> 0.15 = 15% loss
  const size_risk = maxRiskPerTrade / sl_frac;
  const size_alloc = maxAllocationPct * freeCash;
  return Math.min(size_risk, size_alloc, freeCash);
}

/**
 * Execute entry for an alert
 */
function executeEntry(
  state: CapitalState,
  call: CallRecord,
  candles: Candle[],
  params: V1BaselineParams,
  positionSize: number,
  maxHoldHrs: number,
  currentTime: number,
  config: Required<CapitalSimulatorConfig>
): { position: Position; estimatedExitTime: number } | null {
  // Find entry candle (first candle at/after alert time)
  let entryIdx = -1;
  const alertTsMs = call.createdAt.toMillis();

  for (let i = 0; i < candles.length; i++) {
    const tsMs = candles[i].timestamp * 1000;
    if (tsMs >= alertTsMs) {
      entryIdx = i;
      break;
    }
  }

  if (entryIdx === -1 || entryIdx >= candles.length) {
    return null;
  }

  const entryCandle = candles[entryIdx];
  const entryTsMs = entryCandle.timestamp * 1000;
  const entryPx = entryCandle.close;

  if (!isFinite(entryPx) || entryPx <= 0) {
    return null;
  }

  // Deduct position size from free cash
  state.freeCash -= positionSize;

  // Calculate TP/SL prices
  const tpPrice = entryPx * params.tp_mult;
  const slPrice = entryPx * params.sl_mult;
  const maxHoldTsMs = entryTsMs + maxHoldHrs * 60 * 60 * 1000;

  const position: Position = {
    callId: call.id,
    mint: call.mint,
    caller: call.caller,
    entryTsMs,
    entryPx,
    size: positionSize,
    tpPrice,
    slPrice,
    maxHoldTsMs,
  };

  // Estimate exit time (optimistic: assume TP, pessimistic: assume max hold)
  // Use max hold as conservative estimate for event scheduling
  const estimatedExitTime = maxHoldTsMs;

  return { position, estimatedExitTime };
}

/**
 * Find exit point in candle stream
 *
 * Checks exits in priority order: TP, SL, Time
 * Returns the first exit that occurs at or before maxTime
 */
function findExitInCandles(
  candles: Candle[],
  entryTsMs: number,
  entryPx: number,
  tpPrice: number,
  slPrice: number,
  maxHoldTsMs: number,
  maxTime: number
): {
  exitTsMs: number;
  exitPrice: number;
  exitReason: 'take_profit' | 'stop_loss' | 'time_exit';
} {
  // Find entry index
  let entryIdx = -1;
  for (let i = 0; i < candles.length; i++) {
    const tsMs = candles[i].timestamp * 1000;
    if (tsMs >= entryTsMs) {
      entryIdx = i;
      break;
    }
  }

  if (entryIdx === -1) {
    entryIdx = 0;
  }

  // Track earliest exit
  let earliestExit: {
    exitTsMs: number;
    exitPrice: number;
    exitReason: 'take_profit' | 'stop_loss' | 'time_exit';
  } | null = null;

  // Scan for exits (check all three conditions per candle)
  for (let i = entryIdx; i < candles.length; i++) {
    const c = candles[i];
    const tsMs = c.timestamp * 1000;

    // Don't process beyond maxTime
    if (tsMs > maxTime) {
      break;
    }

    // Check take profit first (highest priority if multiple conditions met)
    if (c.high >= tpPrice && (!earliestExit || tsMs < earliestExit.exitTsMs)) {
      earliestExit = {
        exitTsMs: tsMs,
        exitPrice: tpPrice,
        exitReason: 'take_profit',
      };
    }

    // Check stop loss
    if (c.low <= slPrice && (!earliestExit || tsMs < earliestExit.exitTsMs)) {
      earliestExit = {
        exitTsMs: tsMs,
        exitPrice: slPrice,
        exitReason: 'stop_loss',
      };
    }

    // Check time exit (only if we haven't found an earlier exit)
    if (tsMs >= maxHoldTsMs && (!earliestExit || tsMs < earliestExit.exitTsMs)) {
      earliestExit = {
        exitTsMs: tsMs,
        exitPrice: c.close,
        exitReason: 'time_exit',
      };
    }
  }

  // If we found an exit, return it
  if (earliestExit) {
    return earliestExit;
  }

  // No exit found in available candles - use last candle or maxTime
  const lastCandle = candles[candles.length - 1];
  const lastTsMs = lastCandle.timestamp * 1000;

  if (lastTsMs < maxTime) {
    // Last candle is before maxTime, use it as time exit
    return {
      exitTsMs: lastTsMs,
      exitPrice: lastCandle.close,
      exitReason: 'time_exit',
    };
  }

  // Use maxTime as time exit
  return {
    exitTsMs: maxTime,
    exitPrice: lastCandle.close, // Use last known price
    exitReason: 'time_exit',
  };
}

/**
 * Check and execute exits for positions that should exit at or before currentTime
 */
function checkAndExecuteExits(
  state: CapitalState,
  candlesByCallId: Map<string, Candle[]>,
  currentTime: number,
  config: Required<CapitalSimulatorConfig>
): void {
  const positionsToExit: Array<{ position: Position; exitResult: ReturnType<typeof findExitInCandles> }> = [];

  for (const [callId, position] of state.positions) {
    const candles = candlesByCallId.get(callId);
    if (!candles || candles.length === 0) continue;

    // Find exit point up to current time
    const exitResult = findExitInCandles(
      candles,
      position.entryTsMs,
      position.entryPx,
      position.tpPrice,
      position.slPrice,
      position.maxHoldTsMs,
      currentTime
    );

    // Check if exit should have occurred before currentTime
    if (exitResult.exitTsMs <= currentTime) {
      positionsToExit.push({ position, exitResult });
    }
  }

  // Sort exits by timestamp to process in order
  positionsToExit.sort((a, b) => a.exitResult.exitTsMs - b.exitResult.exitTsMs);

  // Execute exits
  for (const { position, exitResult } of positionsToExit) {
    executeExit(state, position, exitResult.exitPrice, exitResult.exitReason, exitResult.exitTsMs, config);
    state.positions.delete(position.callId);
  }
}

/**
 * Execute exit for a position
 */
function executeExit(
  state: CapitalState,
  position: Position,
  exitPrice: number,
  exitReason: 'take_profit' | 'stop_loss' | 'time_exit',
  exitTsMs: number,
  config: Required<CapitalSimulatorConfig>
): void {
  // Calculate exit multiple
  const exitMult = exitPrice / position.entryPx;

  // Calculate PnL: pnl = size * (exit_mult - 1)
  const grossPnl = position.size * (exitMult - 1);

  // Apply fees
  const totalFeeBps = config.fees.takerFeeBps + config.fees.slippageBps;
  const feeAmount = (position.size * totalFeeBps) / 10000 * 2; // Entry + exit
  const netPnl = grossPnl - feeAmount;

  // Update capital: free_cash += size + pnl
  state.freeCash += position.size + netPnl;

  // Calculate unrealized PnL from remaining positions for total capital
  let unrealizedPnl = 0;
  for (const pos of state.positions.values()) {
    // For remaining positions, estimate current value at entry price (conservative)
    // In a more sophisticated version, we'd track current market price
    unrealizedPnl += pos.size * (1 - 1); // For now, assume no unrealized PnL until exit
  }

  state.totalCapital = state.freeCash + unrealizedPnl;

  // Record trade
  const trade: TradeExecution = {
    callId: position.callId,
    entryTsMs: position.entryTsMs,
    exitTsMs,
    entryPx: position.entryPx,
    exitPx: exitPrice,
    size: position.size,
    pnl: netPnl,
    exitReason,
    exitMult,
  };

  state.completedTrades.push(trade);
}

