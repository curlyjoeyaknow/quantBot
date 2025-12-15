/**
 * Base Indicator Types
 * ====================
 * Core interfaces for technical indicators.
 */

import type { Candle, IndicatorName } from '../types';

/**
 * Indicator calculation result
 */
export interface IndicatorResult {
  /** Indicator name */
  name: IndicatorName;
  /** Primary value */
  value: number | null;
  /** Additional fields (e.g., Ichimoku has tenkan, kijun, etc.) */
  fields: Record<string, number | null>;
  /** Whether indicator has enough data */
  ready: boolean;
}

/**
 * Indicator configuration
 */
export interface IndicatorConfig {
  /** Indicator name */
  name: IndicatorName;
  /** Periods/lookback */
  period?: number;
  /** Additional parameters */
  params?: Record<string, unknown>;
}

/**
 * Abstract indicator calculator
 */
export interface IndicatorCalculator {
  /** Indicator name */
  readonly name: IndicatorName;

  /**
   * Calculate indicator for a specific candle index
   *
   * @param candles - Full candle array
   * @param index - Current candle index
   * @param previous - Previous calculation result (for efficiency)
   * @returns Indicator result
   */
  calculate(candles: readonly Candle[], index: number, previous?: IndicatorResult): IndicatorResult;

  /**
   * Minimum candles required for calculation
   */
  minCandles(): number;
}

/**
 * Composite indicator data at a point in time
 */
export interface IndicatorSnapshot {
  /** Current candle */
  candle: Candle;
  /** Candle index */
  index: number;
  /** All indicator results */
  indicators: Map<IndicatorName, IndicatorResult>;
}

/**
 * Helper to get a numeric value from indicator result
 */
export function getIndicatorValue(result: IndicatorResult, field: string = 'value'): number | null {
  if (field === 'value') {
    return result.value;
  }
  return result.fields[field] ?? null;
}

/**
 * Helper to check if indicator is ready
 */
export function isIndicatorReady(result: IndicatorResult): boolean {
  return result.ready && result.value !== null;
}
