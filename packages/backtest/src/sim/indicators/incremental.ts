/**
 * Incremental Indicator Updates
 *
 * Functions for updating indicators incrementally as new candles arrive.
 * Used by causal candle accessor to maintain indicator state across time steps.
 */

import type { Candle } from '../types/candle.js';
import { calculateIndicators, type LegacyIndicatorData } from './registry.js';
import type { MACDState } from './macd.js';
import { calculateMACD } from './macd.js';

/**
 * Update indicator series with new candles
 *
 * @param existingIndicators - Previously calculated indicators
 * @param newCandles - New candles to add (must be sorted by timestamp, after existing candles)
 * @param allCandles - Complete candle array (existing + new)
 * @returns Updated indicator series
 */
export function updateIndicatorsIncremental(
  existingIndicators: LegacyIndicatorData[],
  newCandles: Candle[],
  allCandles: Candle[]
): LegacyIndicatorData[] {
  if (newCandles.length === 0) {
    return existingIndicators;
  }

  const series = [...existingIndicators];
  const startIndex = existingIndicators.length;

  // Get previous state from last indicator
  const lastIndicator = existingIndicators[existingIndicators.length - 1];
  const previousEMAs = lastIndicator
    ? {
        ema9: lastIndicator.movingAverages.ema9,
        ema20: lastIndicator.movingAverages.ema20,
        ema50: lastIndicator.movingAverages.ema50,
      }
    : undefined;

  // Get MACD state by recalculating last candle (to extract state)
  let previousMACDState: MACDState | undefined = undefined;
  if (lastIndicator && startIndex > 0) {
    // Recalculate MACD for the last existing candle to get state
    const macdResult = calculateMACD(allCandles, startIndex - 1, 12, 26, 9, undefined);
    if (macdResult.state) {
      previousMACDState = macdResult.state;
    }
  }

  // Calculate indicators for each new candle
  for (let i = 0; i < newCandles.length; i++) {
    const index = startIndex + i;
    const prev = i > 0 ? series[startIndex + i - 1] : lastIndicator;
    const previousEMAsForCandle = prev
      ? {
          ema9: prev.movingAverages.ema9,
          ema20: prev.movingAverages.ema20,
          ema50: prev.movingAverages.ema50,
        }
      : previousEMAs;

    const result = calculateIndicators(allCandles, index, previousEMAsForCandle, previousMACDState);
    series.push(result);

    // Update MACD state for next iteration
    const macdCalcResult = calculateMACD(allCandles, index, 12, 26, 9, previousMACDState);
    if (macdCalcResult.state) {
      previousMACDState = macdCalcResult.state;
    }
  }

  return series;
}
