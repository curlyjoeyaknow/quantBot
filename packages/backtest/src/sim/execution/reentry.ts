/**
 * Re-Entry Logic
 * ==============
 * Detection and execution of re-entries after exits.
 */

import type { Candle, ReEntryConfig } from '../types/index.js';

/**
 * Re-entry detection result
 */
export interface ReEntryDetectionResult {
  /** Whether re-entry should occur */
  shouldReEnter: boolean;
  /** Re-entry price */
  price: number;
  /** Re-entry size (fraction of original position) */
  size: number;
  /** Description */
  description: string;
  /** Retrace percent from peak/target */
  retracePercent?: number;
}

/**
 * Default re-entry configuration
 */
export const DEFAULT_REENTRY: ReEntryConfig = {
  trailingReEntry: 'none',
  maxReEntries: 0,
  sizePercent: 0.5,
};

/**
 * Re-entry state
 */
export interface ReEntryState {
  /** Whether waiting for re-entry trigger */
  waiting: boolean;
  /** Re-entry trigger price */
  triggerPrice: number;
  /** Reference price (peak or target that triggered wait) */
  referencePrice: number;
  /** Re-entry count so far */
  count: number;
  /** Maximum re-entries allowed */
  maxCount: number;
}

/**
 * Initialize re-entry state
 */
export function initReEntryState(config: ReEntryConfig): ReEntryState {
  return {
    waiting: false,
    triggerPrice: 0,
    referencePrice: 0,
    count: 0,
    maxCount: config.maxReEntries,
  };
}

/**
 * Start waiting for re-entry after an exit
 */
export function startReEntryWait(
  state: ReEntryState,
  referencePrice: number,
  config: ReEntryConfig
): ReEntryState {
  if (config.trailingReEntry === 'none' || state.count >= config.maxReEntries) {
    return state;
  }

  const retracePercent = config.trailingReEntry as number;
  const triggerPrice = referencePrice * (1 - retracePercent);

  return {
    ...state,
    waiting: true,
    triggerPrice,
    referencePrice,
  };
}

/**
 * Check if re-entry is triggered
 */
export function checkReEntry(
  candle: Candle,
  state: ReEntryState,
  config: ReEntryConfig
): ReEntryDetectionResult | null {
  if (!state.waiting || state.count >= state.maxCount) {
    return null;
  }

  if (candle.low <= state.triggerPrice) {
    const retracePercent = config.trailingReEntry as number;
    return {
      shouldReEnter: true,
      price: state.triggerPrice,
      size: config.sizePercent,
      description: `Re-entry at $${state.triggerPrice.toFixed(8)} (${(retracePercent * 100).toFixed(0)}% retrace)`,
      retracePercent,
    };
  }

  return null;
}

/**
 * Validate re-entry sequence
 *
 * Ensures re-entry respects sequential ordering: can't re-enter if stop loss
 * was hit between the exit and the re-entry attempt.
 *
 * @param candles - All candles
 * @param exitIndex - Index where exit occurred
 * @param reEntryIndex - Index where re-entry is attempted
 * @param stopLossPrice - Stop loss price at time of exit
 * @returns True if re-entry is valid (no stop loss hit in between)
 */
export function validateReEntrySequence(
  candles: readonly Candle[],
  exitIndex: number,
  reEntryIndex: number,
  stopLossPrice: number
): boolean {
  // Check if stop loss was hit between exit and re-entry
  for (let i = exitIndex; i < reEntryIndex; i++) {
    if (candles[i].low <= stopLossPrice) {
      return false; // Stop loss hit, can't re-enter
    }
  }
  return true;
}

/**
 * Update re-entry state after re-entry
 */
export function completeReEntry(state: ReEntryState): ReEntryState {
  return {
    ...state,
    waiting: false,
    triggerPrice: 0,
    referencePrice: 0,
    count: state.count + 1,
  };
}

/**
 * Cancel re-entry wait
 */
export function cancelReEntryWait(state: ReEntryState): ReEntryState {
  return {
    ...state,
    waiting: false,
    triggerPrice: 0,
    referencePrice: 0,
  };
}

/**
 * Check if more re-entries are allowed
 */
export function canReEnter(state: ReEntryState): boolean {
  return state.count < state.maxCount;
}
