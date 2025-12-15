/**
 * Indicator Registry
 * ==================
 * Central registry for all indicator calculators.
 */

import type { IndicatorName } from '../types';
import type { Candle } from '../types/candle';
import type { IndicatorCalculator, IndicatorResult, IndicatorSnapshot } from './base';
import { SMACalculator, EMACalculator, calculateMovingAverages } from './moving-averages';
import { IchimokuCalculator, calculateIchimoku, type IchimokuData } from './ichimoku';
import { RSICalculator } from './rsi';
import { MACDCalculator, calculateMACD, type MACDData, type MACDState } from './macd';

// Export IndicatorData as well for backwards compatibility
export type IndicatorData = LegacyIndicatorData;

/**
 * Legacy indicator data interface for backwards compatibility
 */
export interface LegacyIndicatorData {
  candle: Candle;
  index: number;
  movingAverages: {
    sma9: number | null;
    sma20: number | null;
    sma50: number | null;
    ema9: number | null;
    ema20: number | null;
    ema50: number | null;
  };
  ichimoku: IchimokuData | null;
  macd: MACDData | null;
}

/**
 * Indicator registry for managing calculators
 */
export class IndicatorRegistry {
  private calculators = new Map<IndicatorName, IndicatorCalculator>();

  constructor() {
    // Register default calculators
    this.register(new SMACalculator(20));
    this.register(new EMACalculator(20));
    this.register(new IchimokuCalculator());
    this.register(new RSICalculator());
    this.register(new MACDCalculator());
  }

  /**
   * Register an indicator calculator
   */
  register(calculator: IndicatorCalculator): void {
    this.calculators.set(calculator.name, calculator);
  }

  /**
   * Get a calculator by name
   */
  get(name: IndicatorName): IndicatorCalculator | undefined {
    return this.calculators.get(name);
  }

  /**
   * Calculate all registered indicators for a candle
   */
  calculateAll(
    candles: readonly Candle[],
    index: number,
    previousSnapshot?: IndicatorSnapshot
  ): IndicatorSnapshot {
    const indicators = new Map<IndicatorName, IndicatorResult>();

    for (const [name, calculator] of this.calculators) {
      const previous = previousSnapshot?.indicators.get(name);
      const result = calculator.calculate(candles, index, previous);
      indicators.set(name, result);
    }

    return {
      candle: candles[index],
      index,
      indicators,
    };
  }

  /**
   * Calculate specific indicators
   */
  calculate(
    names: IndicatorName[],
    candles: readonly Candle[],
    index: number,
    previousSnapshot?: IndicatorSnapshot
  ): IndicatorSnapshot {
    const indicators = new Map<IndicatorName, IndicatorResult>();

    for (const name of names) {
      const calculator = this.calculators.get(name);
      if (calculator) {
        const previous = previousSnapshot?.indicators.get(name);
        const result = calculator.calculate(candles, index, previous);
        indicators.set(name, result);
      }
    }

    return {
      candle: candles[index],
      index,
      indicators,
    };
  }

  /**
   * Get minimum candles required for any registered indicator
   */
  minCandlesRequired(): number {
    let max = 0;
    for (const calculator of this.calculators.values()) {
      const min = calculator.minCandles();
      if (min > max) max = min;
    }
    return max;
  }

  /**
   * List all registered indicator names
   */
  listIndicators(): IndicatorName[] {
    return Array.from(this.calculators.keys());
  }
}

/**
 * Global indicator registry instance
 */
export const globalIndicatorRegistry = new IndicatorRegistry();

/**
 * Calculate all indicators for a candle (legacy compatible)
 *
 * This function maintains backwards compatibility with the old indicator interface.
 */
export function calculateIndicators(
  candles: readonly Candle[],
  index: number,
  previousEMAs?: {
    ema9?: number | null;
    ema20?: number | null;
    ema50?: number | null;
  },
  previousMACDState?: MACDState
): LegacyIndicatorData {
  const candle = candles[index];
  const movingAverages = calculateMovingAverages(candles, index, previousEMAs);
  const ichimoku = calculateIchimoku(candles, index);

  // Calculate MACD
  const macdResult = calculateMACD(candles, index, 12, 26, 9, previousMACDState);
  const macd: MACDData | null = macdResult.value;

  return {
    candle,
    index,
    movingAverages,
    ichimoku,
    macd,
  };
}

/**
 * Calculate indicator series for all candles
 */
export function calculateIndicatorSeries(candles: readonly Candle[]): LegacyIndicatorData[] {
  const series: LegacyIndicatorData[] = [];
  let previousMACDState: MACDState | undefined = undefined;

  for (let i = 0; i < candles.length; i++) {
    const prev = i > 0 ? series[i - 1] : undefined;
    const previousEMAs = prev
      ? {
          ema9: prev.movingAverages.ema9,
          ema20: prev.movingAverages.ema20,
          ema50: prev.movingAverages.ema50,
        }
      : undefined;

    const result = calculateIndicators(candles, i, previousEMAs, previousMACDState);
    series[i] = result;

    // Update MACD state for next iteration by recalculating
    // This is needed because calculateIndicators doesn't return the state
    const macdCalcResult = calculateMACD(candles, i, 12, 26, 9, previousMACDState);
    if (macdCalcResult.state) {
      previousMACDState = macdCalcResult.state;
    }
  }

  return series;
}

/**
 * Get bullish signals from indicators
 */
export function getBullishSignals(
  current: LegacyIndicatorData,
  previous: LegacyIndicatorData | null
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
  if (current.movingAverages.sma20 !== null && price > current.movingAverages.sma20) {
    signals.push('price_above_sma20');
  }
  if (current.movingAverages.ema20 !== null && price > current.movingAverages.ema20) {
    signals.push('price_above_ema20');
  }

  return signals;
}

/**
 * Get bearish signals from indicators
 */
export function getBearishSignals(
  current: LegacyIndicatorData,
  previous: LegacyIndicatorData | null
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
  if (current.movingAverages.sma20 !== null && price < current.movingAverages.sma20) {
    signals.push('price_below_sma20');
  }
  if (current.movingAverages.ema20 !== null && price < current.movingAverages.ema20) {
    signals.push('price_below_ema20');
  }

  return signals;
}
