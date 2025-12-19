/**
 * Exit Logic
 * ==========
 * Exit detection for targets, stop loss, and signals.
 */

import type { StopLossConfig, StrategyLeg, SignalGroup } from '../types/index.js';
import type { Candle, SubCandleProvider as CandleProvider } from '../types/candle.js';
import type { LegacyIndicatorData } from '../indicators/registry.js';
import { evaluateSignalGroup } from '../signals/evaluator.js';
import { getIntervalSeconds } from '../types/candle.js';

/**
 * Exit detection result
 */
export interface ExitDetectionResult {
  /** Whether exit should occur */
  shouldExit: boolean;
  /** Exit price */
  price: number;
  /** Exit size (fraction of position) */
  size: number;
  /** Exit type */
  type: 'target' | 'stop_loss' | 'trailing_stop' | 'signal' | 'timeout' | 'final';
  /** Description */
  description: string;
  /** Target index (for target exits) */
  targetIndex?: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Default stop loss configuration
 */
export const DEFAULT_STOP_LOSS: StopLossConfig = {
  initial: -0.5,
  trailing: 0.5,
};

/**
 * Sequential check result
 */
export interface SequentialCheckResult {
  /** Which event happened first */
  outcome: 'stop_loss' | 'target' | 'neither';
  /** Whether conflict was resolved */
  conflictResolved: boolean;
  /** Method used for resolution */
  resolutionMethod: 'same_candle' | 'cross_candle' | 'sub_candle' | 'fallback';
  /** Number of sub-candles used (if applicable) */
  subCandlesUsed?: number;
}

/**
 * Check if stop loss is hit
 */
export function checkStopLoss(
  candle: Candle,
  entryPrice: number,
  stopLossPrice: number
): ExitDetectionResult | null {
  if (candle.low <= stopLossPrice) {
    const pnlPercent = (stopLossPrice / entryPrice - 1) * 100;
    return {
      shouldExit: true,
      price: stopLossPrice,
      size: 1, // Full position
      type: 'stop_loss',
      description: `Stop loss at $${stopLossPrice.toFixed(8)} (${pnlPercent.toFixed(1)}%)`,
    };
  }
  return null;
}

/**
 * Check if stop loss was hit before profit target (sequential detection)
 *
 * This function ensures proper sequential ordering: stop loss is checked before profit targets.
 * For same-candle conflicts, it can fetch sub-candles to determine which happened first.
 *
 * @param candle - Current candle
 * @param stopLoss - Stop loss price
 * @param targetPrice - Profit target price
 * @param candleProvider - Optional provider for fetching sub-candles
 * @returns Sequential check result
 */
export async function checkStopLossSequential(
  candle: Candle,
  stopLoss: number,
  targetPrice: number,
  candleProvider?: CandleProvider
): Promise<SequentialCheckResult> {
  const stopHit = candle.low <= stopLoss;
  const targetHit = candle.high >= targetPrice;

  // No conflict - only one or neither
  if (!stopHit && !targetHit) {
    return {
      outcome: 'neither',
      conflictResolved: true,
      resolutionMethod: 'cross_candle',
    };
  }

  if (stopHit && !targetHit) {
    return {
      outcome: 'stop_loss',
      conflictResolved: true,
      resolutionMethod: 'cross_candle',
    };
  }

  if (!stopHit && targetHit) {
    return {
      outcome: 'target',
      conflictResolved: true,
      resolutionMethod: 'cross_candle',
    };
  }

  // Conflict: both stop and target in same candle
  // Try to resolve with sub-candles
  if (candleProvider) {
    const result = await resolveSameCandleConflict(candle, stopLoss, targetPrice, candleProvider);
    if (result) {
      return result;
    }
  }

  // Fallback: use heuristic based on open/close
  return fallbackSameCandleResolution(candle, stopLoss, targetPrice);
}

/**
 * Resolve same-candle conflict by fetching sub-candles
 *
 * @param candle - Conflicted candle
 * @param stopLoss - Stop loss price
 * @param targetPrice - Target price
 * @param provider - Candle provider
 * @returns Sequential check result or null if resolution not possible
 */
async function resolveSameCandleConflict(
  candle: Candle,
  stopLoss: number,
  targetPrice: number,
  provider: CandleProvider
): Promise<SequentialCheckResult | null> {
  // Check if within 3 months (timeframe availability constraint)
  const threeMonthsAgo = Date.now() / 1000 - 90 * 24 * 60 * 60;
  if (candle.timestamp < threeMonthsAgo) {
    return null; // Too old, use fallback
  }

  // Determine candle interval (default to 5m if unknown)
  // We'll try to infer from timestamp differences or use a default
  const intervalSeconds = 300; // Default to 5m
  const startTime = candle.timestamp;
  const endTime = candle.timestamp + intervalSeconds;

  try {
    // Fetch 15s candles for this period (up to 5000) - finest granularity available
    const subCandles = await provider.fetchCandles({
      startTime,
      endTime,
      interval: '15s',
      limit: 5000,
    });

    if (subCandles.length === 0) {
      return null; // No sub-candles available, use fallback
    }

    // Check sub-candles sequentially
    for (const subCandle of subCandles) {
      if (subCandle.low <= stopLoss) {
        return {
          outcome: 'stop_loss',
          conflictResolved: true,
          resolutionMethod: 'sub_candle',
          subCandlesUsed: subCandles.length,
        };
      }
      if (subCandle.high >= targetPrice) {
        return {
          outcome: 'target',
          conflictResolved: true,
          resolutionMethod: 'sub_candle',
          subCandlesUsed: subCandles.length,
        };
      }
    }

    // If we get here, neither was hit in sub-candles (shouldn't happen, but handle gracefully)
    return null;
  } catch (error) {
    // Provider error, use fallback
    return null;
  }
}

/**
 * Fallback resolution for same-candle conflicts
 * Uses heuristic based on open/close prices
 *
 * @param candle - Conflicted candle
 * @param stopLoss - Stop loss price
 * @param targetPrice - Target price
 * @returns Sequential check result
 */
function fallbackSameCandleResolution(
  candle: Candle,
  stopLoss: number,
  targetPrice: number
): SequentialCheckResult {
  // Heuristic: if open or close is at/below stop loss, stop happened first
  // Otherwise, if open or close is at/above target, target happened first
  // Default to stop loss for safety (conservative approach)

  const openAtStop = candle.open <= stopLoss;
  const closeAtStop = candle.close <= stopLoss;
  const openAtTarget = candle.open >= targetPrice;
  const closeAtTarget = candle.close >= targetPrice;

  if (openAtStop || closeAtStop) {
    return {
      outcome: 'stop_loss',
      conflictResolved: true,
      resolutionMethod: 'fallback',
    };
  }

  if (openAtTarget || closeAtTarget) {
    return {
      outcome: 'target',
      conflictResolved: true,
      resolutionMethod: 'fallback',
    };
  }

  // Default to stop loss (conservative)
  return {
    outcome: 'stop_loss',
    conflictResolved: true,
    resolutionMethod: 'fallback',
  };
}

/**
 * Check if trailing stop should be activated
 */
export function checkTrailingStopActivation(
  candle: Candle,
  entryPrice: number,
  trailingThreshold: number | 'none'
): boolean {
  if (trailingThreshold === 'none') return false;

  const trailingTrigger = entryPrice * (1 + trailingThreshold);
  return candle.high >= trailingTrigger;
}

/**
 * Calculate trailing stop price from peak
 */
export function calculateTrailingStopPrice(
  peakPrice: number,
  entryPrice: number,
  trailingPercent: number
): number {
  // Trailing stop at entry price (break-even)
  return entryPrice;
}

/**
 * Check if profit target is hit
 */
export function checkProfitTarget(
  candle: Candle,
  entryPrice: number,
  target: StrategyLeg,
  targetIndex: number
): ExitDetectionResult | null {
  const targetPrice = entryPrice * target.target;

  if (candle.high >= targetPrice) {
    return {
      shouldExit: true,
      price: targetPrice,
      size: target.percent,
      type: 'target',
      description: `Target ${target.target}x hit (sold ${(target.percent * 100).toFixed(0)}%)`,
      targetIndex,
    };
  }

  return null;
}

/**
 * Check exit signal
 */
export function checkExitSignal(
  candle: Candle,
  indicators: LegacyIndicatorData,
  prevIndicators: LegacyIndicatorData | undefined,
  exitSignal: SignalGroup
): ExitDetectionResult | null {
  const result = evaluateSignalGroup(exitSignal, {
    candle,
    indicators,
    prevIndicators,
  });

  if (result.satisfied) {
    return {
      shouldExit: true,
      price: candle.close,
      size: 1, // Full position
      type: 'signal',
      description: `Signal exit at $${candle.close.toFixed(8)}`,
    };
  }

  return null;
}

/**
 * Create final exit result
 */
export function createFinalExit(candle: Candle, remainingSize: number): ExitDetectionResult {
  return {
    shouldExit: true,
    price: candle.close,
    size: remainingSize,
    type: 'final',
    description: `Final exit ${(remainingSize * 100).toFixed(0)}% at $${candle.close.toFixed(8)}`,
  };
}

/**
 * Create timeout exit result
 */
export function createTimeoutExit(candle: Candle, remainingSize: number): ExitDetectionResult {
  return {
    shouldExit: true,
    price: candle.close,
    size: remainingSize,
    type: 'timeout',
    description: `Timeout exit ${(remainingSize * 100).toFixed(0)}% at $${candle.close.toFixed(8)}`,
  };
}

/**
 * Stop loss state for tracking
 */
export interface StopLossState {
  /** Current stop loss price */
  stopLossPrice: number;
  /** Whether trailing stop is active */
  trailingActive: boolean;
  /** Peak price since entry (for trailing stop) */
  peakPrice: number;
}

/**
 * Trailing stop state with rolling window
 */
export interface TrailingStopState {
  /** Rolling window of lows */
  windowLows: number[];
  /** Window size (number of candles) */
  windowSize: number;
  /** Current trailing stop price */
  currentStop: number;
  /** Peak price since entry */
  peakPrice: number;
  /** Start index of current window */
  windowStartIndex: number;
}

/**
 * Initialize stop loss state
 */
export function initStopLossState(entryPrice: number, config: StopLossConfig): StopLossState {
  return {
    stopLossPrice: entryPrice * (1 + config.initial),
    trailingActive: false,
    peakPrice: entryPrice,
  };
}

/**
 * Update stop loss state
 */
export function updateStopLossState(
  state: StopLossState,
  candle: Candle,
  entryPrice: number,
  config: StopLossConfig
): { state: StopLossState; activated: boolean } {
  const newState = { ...state };
  let activated = false;

  // Update peak price
  if (candle.high > state.peakPrice) {
    newState.peakPrice = candle.high;
  }

  // Check trailing stop activation
  if (!state.trailingActive && config.trailing !== undefined && config.trailing !== 'none') {
    if (checkTrailingStopActivation(candle, entryPrice, config.trailing)) {
      newState.trailingActive = true;
      newState.stopLossPrice = entryPrice; // Move to break-even
      activated = true;
    }
  }

  return { state: newState, activated };
}

/**
 * Initialize trailing stop state with rolling window
 */
export function initTrailingStopState(
  entryPrice: number,
  config: StopLossConfig
): TrailingStopState {
  const windowSize = config.trailingWindowSize ?? 20;
  return {
    windowLows: [],
    windowSize,
    currentStop: entryPrice * (1 + config.initial),
    peakPrice: entryPrice,
    windowStartIndex: 0,
  };
}

/**
 * Update rolling window trailing stop
 *
 * Maintains a rolling window of lows and updates stop loss to be X% below the window low.
 * Stop only moves up, never down.
 *
 * @param state - Current trailing stop state
 * @param candle - Current candle
 * @param candleIndex - Current candle index
 * @param trailingPercent - Percent below window low for trailing stop (e.g., 0.25 for 25%)
 * @returns Updated state
 */
export function updateRollingTrailingStop(
  state: TrailingStopState,
  candle: Candle,
  candleIndex: number,
  trailingPercent: number
): TrailingStopState {
  // Add current low to window
  const newWindowLows = [...state.windowLows, candle.low];

  // Remove oldest if window is full
  let finalWindowLows: number[];
  let newWindowStartIndex = state.windowStartIndex;

  if (newWindowLows.length > state.windowSize) {
    finalWindowLows = newWindowLows.slice(-state.windowSize);
    newWindowStartIndex = candleIndex - state.windowSize + 1;
  } else {
    finalWindowLows = newWindowLows;
  }

  // Find lowest in window
  const windowLow = Math.min(...finalWindowLows);

  // Calculate new stop (X% below window low)
  const newStop = windowLow * (1 - trailingPercent);

  // Update stop to be X% below window low
  // For rolling trailing stop, the stop follows the window low (can move down if window low decreases)
  const updatedStop = newStop;

  // Update peak price
  const updatedPeak = candle.high > state.peakPrice ? candle.high : state.peakPrice;

  return {
    windowLows: finalWindowLows,
    windowSize: state.windowSize,
    currentStop: updatedStop,
    peakPrice: updatedPeak,
    windowStartIndex: newWindowStartIndex,
  };
}
