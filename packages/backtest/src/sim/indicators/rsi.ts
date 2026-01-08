/**
 * RSI Indicator
 * =============
 * Relative Strength Index calculation.
 */

import type { Candle } from '../types/index.js';
import type { IndicatorCalculator, IndicatorResult } from './base.js';

const DEFAULT_RSI_PERIOD = 14;

/**
 * RSI calculation state for efficient updates
 */
export interface RSIState {
  avgGain: number;
  avgLoss: number;
  period: number;
}

/**
 * Calculate RSI for a specific candle index
 *
 * @param candles - Full candle array
 * @param index - Current candle index
 * @param period - RSI period (default 14)
 * @param previousState - Previous calculation state for efficiency
 * @returns RSI value and new state
 */
export function calculateRSI(
  candles: readonly Candle[],
  index: number,
  period: number = DEFAULT_RSI_PERIOD,
  previousState?: RSIState
): { value: number | null; state: RSIState | null } {
  if (index < period) {
    return { value: null, state: null };
  }

  // First calculation: average of first `period` gains/losses
  if (!previousState) {
    let gainSum = 0;
    let lossSum = 0;

    for (let i = index - period + 1; i <= index; i++) {
      const change = candles[i].close - candles[i - 1].close;
      if (change > 0) {
        gainSum += change;
      } else {
        lossSum += Math.abs(change);
      }
    }

    const avgGain = gainSum / period;
    const avgLoss = lossSum / period;

    if (avgLoss === 0) {
      return {
        value: 100,
        state: { avgGain, avgLoss, period },
      };
    }

    const rs = avgGain / avgLoss;
    const rsi = 100 - 100 / (1 + rs);

    return {
      value: rsi,
      state: { avgGain, avgLoss, period },
    };
  }

  // Subsequent calculations: use smoothed averages
  const change = candles[index].close - candles[index - 1].close;
  const currentGain = change > 0 ? change : 0;
  const currentLoss = change < 0 ? Math.abs(change) : 0;

  const avgGain = (previousState.avgGain * (period - 1) + currentGain) / period;
  const avgLoss = (previousState.avgLoss * (period - 1) + currentLoss) / period;

  if (avgLoss === 0) {
    return {
      value: 100,
      state: { avgGain, avgLoss, period },
    };
  }

  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);

  return {
    value: rsi,
    state: { avgGain, avgLoss, period },
  };
}

/**
 * RSI Calculator
 */
export class RSICalculator implements IndicatorCalculator {
  readonly name = 'rsi' as const;
  private readonly period: number;
  private state: RSIState | null = null;

  constructor(period: number = DEFAULT_RSI_PERIOD) {
    this.period = period;
  }

  calculate(
    candles: readonly Candle[],
    index: number,
    _previous?: IndicatorResult
  ): IndicatorResult {
    const result = calculateRSI(candles, index, this.period, this.state ?? undefined);
    this.state = result.state;

    return {
      name: this.name,
      value: result.value,
      fields: {
        rsi: result.value,
        isOverbought: result.value !== null && result.value > 70 ? 1 : 0,
        isOversold: result.value !== null && result.value < 30 ? 1 : 0,
      },
      ready: result.value !== null,
    };
  }

  minCandles(): number {
    return this.period + 1;
  }

  reset(): void {
    this.state = null;
  }
}

/**
 * Check if RSI is overbought
 */
export function isRSIOverbought(rsi: number | null, threshold: number = 70): boolean {
  return rsi !== null && rsi > threshold;
}

/**
 * Check if RSI is oversold
 */
export function isRSIOversold(rsi: number | null, threshold: number = 30): boolean {
  return rsi !== null && rsi < threshold;
}

/**
 * Check for RSI divergence (bullish - price makes lower low, RSI makes higher low)
 */
export function isRSIBullishDivergence(
  candles: readonly Candle[],
  rsiValues: readonly (number | null)[],
  lookback: number = 14
): boolean {
  // Simplified: check if current price is at a lower low but RSI is higher
  // A full implementation would need proper swing detection
  const currentIndex = candles.length - 1;
  if (currentIndex < lookback) return false;

  const currentPrice = candles[currentIndex].low;
  const currentRSI = rsiValues[currentIndex];

  if (currentRSI === null) return false;

  // Find previous low within lookback
  let prevLowIndex = -1;
  let prevLowPrice = Infinity;

  for (let i = currentIndex - 3; i >= currentIndex - lookback && i >= 0; i--) {
    if (candles[i].low < prevLowPrice && candles[i].low < candles[i + 1].low) {
      prevLowPrice = candles[i].low;
      prevLowIndex = i;
      break;
    }
  }

  if (prevLowIndex === -1 || rsiValues[prevLowIndex] === null) return false;

  return currentPrice < prevLowPrice && currentRSI > rsiValues[prevLowIndex]!;
}
