/**
 * TradeLifecycle - Helpers for entry, exit, stop, trailing logic
 *
 * Utility functions for trade lifecycle management in simulations.
 */

import type { Candle, StopLossConfig, EntryConfig } from '../types';

export interface PositionState {
  size: number;
  entryPrice: number;
  entryTimestamp: number;
  stopLoss?: number;
  trailingStop?: number;
  profitTargets: Array<{ target: number; percent: number; hit: boolean }>;
}

/**
 * Calculate stop loss price
 */
export function calculateStopLoss(entryPrice: number, stopLossConfig: StopLossConfig): number {
  return entryPrice * (1 + stopLossConfig.initial);
}

/**
 * Update trailing stop
 */
export function updateTrailingStop(
  currentPrice: number,
  position: PositionState,
  stopLossConfig: StopLossConfig
): number | undefined {
  if (stopLossConfig.trailing === 'none') {
    return undefined;
  }

  const trailingPercent = stopLossConfig.trailing as number;
  const newTrailingStop = currentPrice * (1 - trailingPercent);

  if (!position.trailingStop || newTrailingStop > position.trailingStop) {
    return newTrailingStop;
  }

  return position.trailingStop;
}

/**
 * Check if profit target is hit
 */
export function checkProfitTarget(
  currentPrice: number,
  entryPrice: number,
  target: number
): boolean {
  return currentPrice >= entryPrice * target;
}

/**
 * Check if stop loss is hit
 */
export function checkStopLoss(currentPrice: number, stopLoss: number): boolean {
  return currentPrice <= stopLoss;
}

/**
 * Calculate entry price with trailing entry
 */
export function calculateTrailingEntry(
  candles: Candle[],
  startIndex: number,
  entryConfig: EntryConfig
): { price: number; index: number } | null {
  if (entryConfig.trailingEntry === 'none') {
    return null;
  }

  const trailingPercent = entryConfig.trailingEntry as number;
  let lowestPrice = candles[startIndex].low;
  let lowestIndex = startIndex;

  for (let i = startIndex; i < candles.length; i++) {
    if (candles[i].low < lowestPrice) {
      lowestPrice = candles[i].low;
      lowestIndex = i;
    }

    // Check if we've exceeded max wait time
    const minutesElapsed = (candles[i].timestamp - candles[startIndex].timestamp) / 60;
    if (minutesElapsed > entryConfig.maxWaitTime) {
      break;
    }
  }

  const entryPrice = lowestPrice * (1 + trailingPercent);
  return { price: entryPrice, index: lowestIndex };
}
