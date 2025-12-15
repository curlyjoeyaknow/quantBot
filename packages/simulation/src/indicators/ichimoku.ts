/**
 * Ichimoku Cloud Indicator
 * ========================
 * Full Ichimoku Kinko Hyo calculation.
 */

import type { Candle } from '../types';
import type { IndicatorCalculator, IndicatorResult } from './base';

/**
 * Default Ichimoku periods
 */
export const ICHIMOKU_PERIODS = {
  TENKAN: 9,
  KIJUN: 26,
  SENKOU_SPAN_B: 52,
  DISPLACEMENT: 26,
} as const;

/**
 * Ichimoku data structure
 */
export interface IchimokuData {
  /** Tenkan-sen (Conversion Line) */
  tenkan: number;
  /** Kijun-sen (Base Line) */
  kijun: number;
  /** Senkou Span A (Leading Span A) - primary name */
  senkouA: number;
  /** Senkou Span B (Leading Span B) - primary name */
  senkouB: number;
  /** Senkou Span A alias for compatibility */
  span_a: number;
  /** Senkou Span B alias for compatibility */
  span_b: number;
  /** Chikou Span (Lagging Span) */
  chikou: number;
  /** Cloud top (max of span_a, span_b) */
  cloudTop: number;
  /** Cloud bottom (min of span_a, span_b) */
  cloudBottom: number;
  /** Cloud thickness (cloudTop - cloudBottom) */
  cloudThickness: number;
  /** Is price above cloud (bullish) */
  isBullish: boolean;
  /** Is price below cloud (bearish) */
  isBearish: boolean;
  /** Is price inside cloud */
  inCloud: boolean;
  /** Is Tenkan above Kijun (momentum) */
  isTenkanAboveKijun: boolean;
}

/**
 * Calculate highest high over a period
 */
function highestHigh(candles: readonly Candle[], endIndex: number, period: number): number {
  let highest = -Infinity;
  const startIndex = Math.max(0, endIndex - period + 1);
  for (let i = startIndex; i <= endIndex; i++) {
    if (candles[i].high > highest) {
      highest = candles[i].high;
    }
  }
  return highest;
}

/**
 * Calculate lowest low over a period
 */
function lowestLow(candles: readonly Candle[], endIndex: number, period: number): number {
  let lowest = Infinity;
  const startIndex = Math.max(0, endIndex - period + 1);
  for (let i = startIndex; i <= endIndex; i++) {
    if (candles[i].low < lowest) {
      lowest = candles[i].low;
    }
  }
  return lowest;
}

/**
 * Calculate Ichimoku values for a specific candle
 *
 * @param candles - Full candle array (sorted ascending by timestamp)
 * @param index - Current candle index
 * @returns Ichimoku data or null if insufficient data
 */
export function calculateIchimoku(candles: readonly Candle[], index: number): IchimokuData | null {
  // Need at least 52 periods for Senkou Span B
  if (index < ICHIMOKU_PERIODS.SENKOU_SPAN_B - 1) {
    return null;
  }

  // Tenkan-sen (Conversion Line): (9-period high + 9-period low) / 2
  const tenkanHigh = highestHigh(candles, index, ICHIMOKU_PERIODS.TENKAN);
  const tenkanLow = lowestLow(candles, index, ICHIMOKU_PERIODS.TENKAN);
  const tenkan = (tenkanHigh + tenkanLow) / 2;

  // Kijun-sen (Base Line): (26-period high + 26-period low) / 2
  const kijunHigh = highestHigh(candles, index, ICHIMOKU_PERIODS.KIJUN);
  const kijunLow = lowestLow(candles, index, ICHIMOKU_PERIODS.KIJUN);
  const kijun = (kijunHigh + kijunLow) / 2;

  // Senkou Span A (Leading Span A): (Tenkan + Kijun) / 2, displaced 26 periods ahead
  const span_a = (tenkan + kijun) / 2;

  // Senkou Span B (Leading Span B): (52-period high + 52-period low) / 2
  const spanBHigh = highestHigh(candles, index, ICHIMOKU_PERIODS.SENKOU_SPAN_B);
  const spanBLow = lowestLow(candles, index, ICHIMOKU_PERIODS.SENKOU_SPAN_B);
  const span_b = (spanBHigh + spanBLow) / 2;

  // Chikou Span (Lagging Span): Close displaced 26 periods behind
  const chikou = candles[index].close;

  // Cloud calculations
  const cloudTop = Math.max(span_a, span_b);
  const cloudBottom = Math.min(span_a, span_b);
  const cloudThickness = cloudTop - cloudBottom;

  // Position analysis
  const currentPrice = candles[index].close;
  const isBullish = currentPrice > cloudTop;
  const isBearish = currentPrice < cloudBottom;
  const inCloud = !isBullish && !isBearish;
  const isTenkanAboveKijun = tenkan > kijun;

  return {
    tenkan,
    kijun,
    senkouA: span_a,
    senkouB: span_b,
    span_a,
    span_b,
    chikou,
    cloudTop,
    cloudBottom,
    cloudThickness,
    isBullish,
    isBearish,
    inCloud,
    isTenkanAboveKijun,
  };
}

/**
 * Ichimoku Cloud Calculator
 */
export class IchimokuCalculator implements IndicatorCalculator {
  readonly name = 'ichimoku_cloud' as const;

  calculate(
    candles: readonly Candle[],
    index: number,
    _previous?: IndicatorResult
  ): IndicatorResult {
    const ichimoku = calculateIchimoku(candles, index);

    if (!ichimoku) {
      return {
        name: this.name,
        value: null,
        fields: {},
        ready: false,
      };
    }

    // Primary value is cloud direction: 1 for bullish, -1 for bearish, 0 for neutral
    const value = ichimoku.isBullish ? 1 : ichimoku.isBearish ? -1 : 0;

    return {
      name: this.name,
      value,
      fields: {
        tenkan: ichimoku.tenkan,
        kijun: ichimoku.kijun,
        spanA: ichimoku.span_a,
        spanB: ichimoku.span_b,
        chikou: ichimoku.chikou,
        cloudTop: ichimoku.cloudTop,
        cloudBottom: ichimoku.cloudBottom,
        cloudThickness: ichimoku.cloudThickness,
        isBullish: ichimoku.isBullish ? 1 : 0,
        isBearish: ichimoku.isBearish ? 1 : 0,
        isTenkanAboveKijun: ichimoku.isTenkanAboveKijun ? 1 : 0,
      },
      ready: true,
    };
  }

  minCandles(): number {
    return ICHIMOKU_PERIODS.SENKOU_SPAN_B;
  }
}

/**
 * Check for Tenkan-Kijun cross
 */
export function isTenkanKijunCrossUp(
  current: IchimokuData | null,
  previous: IchimokuData | null
): boolean {
  if (!current || !previous) return false;
  return previous.tenkan <= previous.kijun && current.tenkan > current.kijun;
}

/**
 * Check for Tenkan-Kijun cross down
 */
export function isTenkanKijunCrossDown(
  current: IchimokuData | null,
  previous: IchimokuData | null
): boolean {
  if (!current || !previous) return false;
  return previous.tenkan >= previous.kijun && current.tenkan < current.kijun;
}

/**
 * Check for cloud breakout (bullish)
 */
export function isCloudBreakoutUp(
  current: IchimokuData | null,
  previous: IchimokuData | null
): boolean {
  if (!current || !previous) return false;
  return !previous.isBullish && current.isBullish;
}

/**
 * Check for cloud breakout (bearish)
 */
export function isCloudBreakoutDown(
  current: IchimokuData | null,
  previous: IchimokuData | null
): boolean {
  if (!current || !previous) return false;
  return !previous.isBearish && current.isBearish;
}
