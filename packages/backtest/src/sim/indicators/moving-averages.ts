/**
 * Moving Average Indicators
 * =========================
 * SMA, EMA, and other moving average calculations.
 */

import type { Candle } from '../types/index.js';
import type { IndicatorCalculator, IndicatorResult } from './base.js';

/**
 * Calculate Simple Moving Average
 */
export function calculateSMA(
  candles: readonly Candle[],
  period: number,
  index: number
): number | null {
  if (index < period - 1 || candles.length < period) {
    return null;
  }

  let sum = 0;
  for (let i = index - period + 1; i <= index; i++) {
    sum += candles[i].close;
  }
  return sum / period;
}

/**
 * Calculate Exponential Moving Average
 */
export function calculateEMA(
  candles: readonly Candle[],
  period: number,
  index: number,
  previousEMA?: number | null
): number | null {
  if (index < period - 1 || candles.length < period) {
    return null;
  }

  const multiplier = 2 / (period + 1);
  const currentPrice = candles[index].close;

  if (previousEMA === null || previousEMA === undefined) {
    // Initialize with SMA
    const sma = calculateSMA(candles, period, index);
    if (sma === null) return null;
    return (currentPrice - sma) * multiplier + sma;
  }

  return (currentPrice - previousEMA) * multiplier + previousEMA;
}

/**
 * Moving averages result
 */
export interface MovingAveragesResult {
  sma9: number | null;
  sma20: number | null;
  sma50: number | null;
  ema9: number | null;
  ema20: number | null;
  ema50: number | null;
}

/**
 * Calculate all standard moving averages
 */
export function calculateMovingAverages(
  candles: readonly Candle[],
  index: number,
  previousEMAs?: {
    ema9?: number | null;
    ema20?: number | null;
    ema50?: number | null;
  }
): MovingAveragesResult {
  return {
    sma9: calculateSMA(candles, 9, index),
    sma20: calculateSMA(candles, 20, index),
    sma50: calculateSMA(candles, 50, index),
    ema9: calculateEMA(candles, 9, index, previousEMAs?.ema9),
    ema20: calculateEMA(candles, 20, index, previousEMAs?.ema20),
    ema50: calculateEMA(candles, 50, index, previousEMAs?.ema50),
  };
}

/**
 * SMA Calculator
 */
export class SMACalculator implements IndicatorCalculator {
  readonly name = 'sma' as const;
  private readonly period: number;

  constructor(period: number = 20) {
    this.period = period;
  }

  calculate(
    candles: readonly Candle[],
    index: number,
    _previous?: IndicatorResult
  ): IndicatorResult {
    const value = calculateSMA(candles, this.period, index);
    return {
      name: this.name,
      value,
      fields: { [`sma${this.period}`]: value },
      ready: value !== null,
    };
  }

  minCandles(): number {
    return this.period;
  }
}

/**
 * EMA Calculator
 */
export class EMACalculator implements IndicatorCalculator {
  readonly name = 'ema' as const;
  private readonly period: number;

  constructor(period: number = 20) {
    this.period = period;
  }

  calculate(
    candles: readonly Candle[],
    index: number,
    previous?: IndicatorResult
  ): IndicatorResult {
    const prevValue = previous?.value ?? undefined;
    const value = calculateEMA(candles, this.period, index, prevValue);
    return {
      name: this.name,
      value,
      fields: { [`ema${this.period}`]: value },
      ready: value !== null,
    };
  }

  minCandles(): number {
    return this.period;
  }
}

/**
 * Check if price is above moving average
 */
export function isPriceAboveMA(price: number, ma: number | null): boolean {
  return ma !== null && price > ma;
}

/**
 * Check if price is below moving average
 */
export function isPriceBelowMA(price: number, ma: number | null): boolean {
  return ma !== null && price < ma;
}

/**
 * Check for golden cross (fast MA crosses above slow MA)
 */
export function isGoldenCross(
  fastMA: number | null,
  slowMA: number | null,
  prevFastMA: number | null,
  prevSlowMA: number | null
): boolean {
  if (!fastMA || !slowMA || prevFastMA === null || prevSlowMA === null) {
    return false;
  }
  return prevFastMA <= prevSlowMA && fastMA > slowMA;
}

/**
 * Check for death cross (fast MA crosses below slow MA)
 */
export function isDeathCross(
  fastMA: number | null,
  slowMA: number | null,
  prevFastMA: number | null,
  prevSlowMA: number | null
): boolean {
  if (!fastMA || !slowMA || prevFastMA === null || prevSlowMA === null) {
    return false;
  }
  return prevFastMA >= prevSlowMA && fastMA < slowMA;
}
