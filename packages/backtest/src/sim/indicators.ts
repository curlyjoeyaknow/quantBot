/**
 * Technical Indicators for Trading Simulations
 * ============================================
 * Provides moving averages and integrates with Ichimoku Cloud
 */

import type { Candle } from '@quantbot/core';
import { calculateIchimoku, IchimokuData } from './ichimoku.js';

export interface MovingAverages {
  sma9: number | null;
  sma20: number | null;
  sma50: number | null;
  ema9: number | null;
  ema20: number | null;
  ema50: number | null;
}

export interface IndicatorData {
  candle: Candle;
  index: number;
  movingAverages: MovingAverages;
  ichimoku: IchimokuData | null;
}

/**
 * Calculate Simple Moving Average (SMA)
 */
export function calculateSMA(
  candles: Candle[],
  period: number,
  currentIndex: number
): number | null {
  if (currentIndex < period - 1 || candles.length < period) {
    return null;
  }

  const slice = candles.slice(currentIndex - period + 1, currentIndex + 1);
  const sum = slice.reduce((acc, candle) => acc + candle.close, 0);
  return sum / period;
}

/**
 * Calculate Exponential Moving Average (EMA)
 */
export function calculateEMA(
  candles: Candle[],
  period: number,
  currentIndex: number,
  previousEMA?: number | null
): number | null {
  if (currentIndex < period - 1 || candles.length < period) {
    return null;
  }

  const multiplier = 2 / (period + 1);
  const currentPrice = candles[currentIndex].close;

  if (previousEMA === null || previousEMA === undefined) {
    // Initialize with SMA
    const sma = calculateSMA(candles, period, currentIndex);
    if (sma === null) return null;
    return (currentPrice - sma) * multiplier + sma;
  }

  return (currentPrice - previousEMA) * multiplier + previousEMA;
}

/**
 * Calculate all moving averages for a candle
 */
export function calculateMovingAverages(
  candles: Candle[],
  currentIndex: number,
  previousEMAs?: { ema9?: number | null; ema20?: number | null; ema50?: number | null }
): MovingAverages {
  return {
    sma9: calculateSMA(candles, 9, currentIndex),
    sma20: calculateSMA(candles, 20, currentIndex),
    sma50: calculateSMA(candles, 50, currentIndex),
    ema9: calculateEMA(candles, 9, currentIndex, previousEMAs?.ema9),
    ema20: calculateEMA(candles, 20, currentIndex, previousEMAs?.ema20),
    ema50: calculateEMA(candles, 50, currentIndex, previousEMAs?.ema50),
  };
}

/**
 * Calculate all indicators for a candle
 */
export function calculateIndicators(
  candles: Candle[],
  currentIndex: number,
  previousEMAs?: { ema9?: number | null; ema20?: number | null; ema50?: number | null }
): IndicatorData {
  const candle = candles[currentIndex];
  const movingAverages = calculateMovingAverages(candles, currentIndex, previousEMAs);
  const ichimoku = calculateIchimoku(candles, currentIndex);

  return {
    candle,
    index: currentIndex,
    movingAverages,
    ichimoku,
  };
}

/**
 * Check if price is above moving average (bullish signal)
 */
export function isPriceAboveMA(price: number, ma: number | null): boolean {
  return ma !== null && price > ma;
}

/**
 * Check if price is below moving average (bearish signal)
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

/**
 * Get bullish indicator signals
 */
export function getBullishSignals(
  current: IndicatorData,
  previous: IndicatorData | null
): string[] {
  const signals: string[] = [];
  const price = current.candle.close;

  // Ichimoku signals
  if (current.ichimoku) {
    if (current.ichimoku.isBullish) {
      signals.push('ichimoku_bullish');
    }
    if (previous?.ichimoku && !previous.ichimoku.isBullish && current.ichimoku.isBullish) {
      signals.push('ichimoku_cloud_cross_up');
    }
    if (
      previous?.ichimoku &&
      previous.ichimoku.tenkan <= previous.ichimoku.kijun &&
      current.ichimoku.tenkan > current.ichimoku.kijun
    ) {
      signals.push('ichimoku_tenkan_kijun_cross_up');
    }
  }

  // Moving average signals
  if (isPriceAboveMA(price, current.movingAverages.sma20)) {
    signals.push('price_above_sma20');
  }
  if (isPriceAboveMA(price, current.movingAverages.ema20)) {
    signals.push('price_above_ema20');
  }
  if (
    isGoldenCross(
      current.movingAverages.ema9,
      current.movingAverages.ema20,
      previous?.movingAverages.ema9 || null,
      previous?.movingAverages.ema20 || null
    )
  ) {
    signals.push('golden_cross');
  }

  return signals;
}

/**
 * Get bearish indicator signals
 */
export function getBearishSignals(
  current: IndicatorData,
  previous: IndicatorData | null
): string[] {
  const signals: string[] = [];
  const price = current.candle.close;

  // Ichimoku signals
  if (current.ichimoku) {
    if (current.ichimoku.isBearish) {
      signals.push('ichimoku_bearish');
    }
    if (previous?.ichimoku && !previous.ichimoku.isBearish && current.ichimoku.isBearish) {
      signals.push('ichimoku_cloud_cross_down');
    }
    if (
      previous?.ichimoku &&
      previous.ichimoku.tenkan >= previous.ichimoku.kijun &&
      current.ichimoku.tenkan < current.ichimoku.kijun
    ) {
      signals.push('ichimoku_tenkan_kijun_cross_down');
    }
  }

  // Moving average signals
  if (isPriceBelowMA(price, current.movingAverages.sma20)) {
    signals.push('price_below_sma20');
  }
  if (isPriceBelowMA(price, current.movingAverages.ema20)) {
    signals.push('price_below_ema20');
  }
  if (
    isDeathCross(
      current.movingAverages.ema9,
      current.movingAverages.ema20,
      previous?.movingAverages.ema9 || null,
      previous?.movingAverages.ema20 || null
    )
  ) {
    signals.push('death_cross');
  }

  return signals;
}

/**
 * Check if indicators support bullish entry
 */
export function isBullishEntry(current: IndicatorData, previous: IndicatorData | null): boolean {
  const bullishSignals = getBullishSignals(current, previous);

  // Require at least one strong signal
  const strongSignals = [
    'ichimoku_cloud_cross_up',
    'ichimoku_tenkan_kijun_cross_up',
    'golden_cross',
  ];
  return bullishSignals.some((signal) => strongSignals.includes(signal));
}

/**
 * Check if indicators suggest exit
 */
export function isBearishExit(current: IndicatorData, previous: IndicatorData | null): boolean {
  const bearishSignals = getBearishSignals(current, previous);

  // Require at least one strong signal
  const strongSignals = [
    'ichimoku_cloud_cross_down',
    'ichimoku_tenkan_kijun_cross_down',
    'death_cross',
  ];
  return bearishSignals.some((signal) => strongSignals.includes(signal));
}
