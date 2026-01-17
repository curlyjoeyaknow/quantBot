/**
 * Indicator Series Utilities
 *
 * Array-based indicator calculations for exit plan evaluation.
 * Leverages @quantbot/simulation where possible, with array adapters.
 */

import type { Candle } from '@quantbot/core';

// Re-export simulation's candle-based calculators for advanced use
export {
  calculateEMA as calculateEMAAtIndex,
  calculateSMA as calculateSMAAtIndex,
  calculateMovingAverages,
  isGoldenCross,
  isDeathCross,
} from '../sim/indicators/index.js';

export { calculateRSI as calculateRSIAtIndex } from '../sim/indicators/rsi.js';

export { calculateIchimoku, type IchimokuData } from '../sim/indicators/ichimoku.js';

export { calculateMACD, type MACDData, type MACDState } from '../sim/indicators/macd.js';

export {
  calculateIndicators,
  calculateIndicatorSeries,
  getBullishSignals,
  getBearishSignals,
  type LegacyIndicatorData,
  type IndicatorData,
} from '../sim/indicators/registry.js';

// =============================================================================
// Array-based indicator functions (for exit plan evaluation)
// These operate on value arrays rather than candle indices.
// =============================================================================

export function closeSeries(candles: Candle[]): number[] {
  return candles.map((c) => c.close);
}

export function hl2Series(candles: Candle[]): number[] {
  return candles.map((c) => (c.high + c.low) / 2);
}

export function highSeries(candles: Candle[]): number[] {
  return candles.map((c) => c.high);
}

export function lowSeries(candles: Candle[]): number[] {
  return candles.map((c) => c.low);
}

export function volumeSeries(candles: Candle[]): number[] {
  return candles.map((c) => c.volume);
}

/**
 * Exponential Moving Average over a value array
 */
export function ema(values: number[], period: number): Array<number | null> {
  if (period <= 0) throw new Error('EMA period must be > 0');
  const out: Array<number | null> = new Array(values.length).fill(null);
  const k = 2 / (period + 1);

  let emaPrev: number | null = null;
  let sum = 0;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!isFinite(v)) {
      out[i] = null;
      continue;
    }

    if (i < period) {
      sum += v;
      if (i === period - 1) {
        emaPrev = sum / period;
        out[i] = emaPrev;
      }
      continue;
    }

    emaPrev = emaPrev === null ? v : (v - emaPrev) * k + emaPrev;
    out[i] = emaPrev;
  }

  return out;
}

/**
 * Simple Moving Average over a value array
 */
export function sma(values: number[], period: number): Array<number | null> {
  if (period <= 0) throw new Error('SMA period must be > 0');
  const out: Array<number | null> = new Array(values.length).fill(null);

  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += values[j];
    }
    out[i] = sum / period;
  }

  return out;
}

/**
 * RSI over a value array (Wilder's smoothed RSI)
 */
export function rsi(values: number[], period: number): Array<number | null> {
  if (period <= 0) throw new Error('RSI period must be > 0');
  const out: Array<number | null> = new Array(values.length).fill(null);

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    if (i <= period) {
      avgGain += gain;
      avgLoss += loss;

      if (i === period) {
        avgGain /= period;
        avgLoss /= period;
        const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
        out[i] = 100 - 100 / (1 + rs);
      }
      continue;
    }

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    out[i] = 100 - 100 / (1 + rs);
  }

  return out;
}

/**
 * Ichimoku Tenkan/Kijun lines
 */
export function ichimokuTenkanKijun(
  candles: Candle[],
  tenkanPeriod: number,
  kijunPeriod: number
): { tenkan: Array<number | null>; kijun: Array<number | null> } {
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  const tenkan: Array<number | null> = new Array(candles.length).fill(null);
  const kijun: Array<number | null> = new Array(candles.length).fill(null);

  for (let i = 0; i < candles.length; i++) {
    if (i >= tenkanPeriod - 1) {
      const hh = rollingMax(highs, tenkanPeriod, i);
      const ll = rollingMin(lows, tenkanPeriod, i);
      tenkan[i] = (hh + ll) / 2;
    }
    if (i >= kijunPeriod - 1) {
      const hh = rollingMax(highs, kijunPeriod, i);
      const ll = rollingMin(lows, kijunPeriod, i);
      kijun[i] = (hh + ll) / 2;
    }
  }

  return { tenkan, kijun };
}

/**
 * Volume Z-Score (deviation from rolling mean)
 */
export function volumeZScore(candles: Candle[], window: number): Array<number | null> {
  const out: Array<number | null> = new Array(candles.length).fill(null);
  const vols = candles.map((c) => c.volume);

  for (let i = 0; i < candles.length; i++) {
    if (i < window - 1) continue;
    const start = i - window + 1;
    let sum = 0;
    for (let j = start; j <= i; j++) sum += vols[j];
    const mean = sum / window;

    let varSum = 0;
    for (let j = start; j <= i; j++) {
      const d = vols[j] - mean;
      varSum += d * d;
    }
    const std = Math.sqrt(varSum / window);
    out[i] = std === 0 ? 0 : (vols[i] - mean) / std;
  }

  return out;
}

/**
 * Detect cross between two series
 */
export function crossed(
  prevA: number | null,
  prevB: number | null,
  currA: number | null,
  currB: number | null,
  direction: 'bearish' | 'bullish'
): boolean {
  if (prevA === null || prevB === null || currA === null || currB === null) return false;
  const prev = prevA - prevB;
  const curr = currA - currB;
  return direction === 'bearish' ? prev > 0 && curr <= 0 : prev < 0 && curr >= 0;
}

/**
 * Detect cross through a level
 */
export function crossedLevel(
  prevV: number | null,
  currV: number | null,
  level: number,
  direction: 'down' | 'up'
): boolean {
  if (prevV === null || currV === null) return false;
  return direction === 'down' ? prevV > level && currV <= level : prevV < level && currV >= level;
}

// =============================================================================
// Helpers
// =============================================================================

function rollingMax(arr: number[], window: number, i: number): number {
  let m = -Infinity;
  for (let j = Math.max(0, i - window + 1); j <= i; j++) m = Math.max(m, arr[j]);
  return m;
}

function rollingMin(arr: number[], window: number, i: number): number {
  let m = Infinity;
  for (let j = Math.max(0, i - window + 1); j <= i; j++) m = Math.min(m, arr[j]);
  return m;
}
