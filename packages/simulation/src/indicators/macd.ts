/**
 * MACD Indicator
 * ===============
 * Moving Average Convergence Divergence calculation.
 */

import type { Candle } from '../types';
import type { IndicatorCalculator, IndicatorResult } from './base';
import { calculateEMA } from './moving-averages';

const DEFAULT_FAST_PERIOD = 12;
const DEFAULT_SLOW_PERIOD = 26;
const DEFAULT_SIGNAL_PERIOD = 9;

/**
 * MACD calculation state for efficient updates
 */
export interface MACDState {
  fastEMA: number;
  slowEMA: number;
  macdLine: number;
  signalEMA: number;
  fastPeriod: number;
  slowPeriod: number;
  signalPeriod: number;
}

/**
 * MACD data structure
 */
export interface MACDData {
  macd: number;
  signal: number;
  histogram: number;
  isBullish: boolean; // MACD > signal
  isBearish: boolean; // MACD < signal
}

/**
 * Calculate MACD for a specific candle index
 *
 * @param candles - Full candle array
 * @param index - Current candle index
 * @param fastPeriod - Fast EMA period (default 12)
 * @param slowPeriod - Slow EMA period (default 26)
 * @param signalPeriod - Signal line EMA period (default 9)
 * @param previousState - Previous calculation state for efficiency
 * @returns MACD data and new state
 */
export function calculateMACD(
  candles: readonly Candle[],
  index: number,
  fastPeriod: number = DEFAULT_FAST_PERIOD,
  slowPeriod: number = DEFAULT_SLOW_PERIOD,
  signalPeriod: number = DEFAULT_SIGNAL_PERIOD,
  previousState?: MACDState
): { value: MACDData | null; state: MACDState | null } {
  // Need at least slowPeriod candles for initial calculation
  if (index < slowPeriod - 1) {
    return { value: null, state: null };
  }

  // Calculate fast and slow EMAs
  const fastEMA = calculateEMA(candles, fastPeriod, index, previousState?.fastEMA);
  const slowEMA = calculateEMA(candles, slowPeriod, index, previousState?.slowEMA);

  if (fastEMA === null || slowEMA === null) {
    return { value: null, state: null };
  }

  // Calculate MACD line
  const macdLine = fastEMA - slowEMA;

  // Calculate signal line (EMA of MACD line)
  // Need additional signalPeriod candles after slowPeriod for signal
  if (index < slowPeriod - 1 + signalPeriod - 1) {
    // Store state but don't return value yet
    const newState: MACDState = {
      fastEMA,
      slowEMA,
      macdLine,
      signalEMA: 0, // Will be calculated later
      fastPeriod,
      slowPeriod,
      signalPeriod,
    };
    return { value: null, state: newState };
  }

  // Calculate signal EMA
  // For the first signal calculation, we need to build up MACD values
  let signalEMA: number;
  if (!previousState || previousState.signalEMA === 0) {
    // Initialize signal EMA with SMA of MACD values
    let macdSum = 0;
    const macdValues: number[] = [];

    // Calculate MACD values for signalPeriod candles
    for (let i = index - signalPeriod + 1; i <= index; i++) {
      const fast = calculateEMA(candles, fastPeriod, i);
      const slow = calculateEMA(candles, slowPeriod, i);
      if (fast !== null && slow !== null) {
        const macd = fast - slow;
        macdValues.push(macd);
        macdSum += macd;
      }
    }

    if (macdValues.length < signalPeriod) {
      return { value: null, state: null };
    }

    signalEMA = macdSum / signalPeriod;
  } else {
    // Use EMA formula for signal line
    const multiplier = 2 / (signalPeriod + 1);
    signalEMA = (macdLine - previousState.signalEMA) * multiplier + previousState.signalEMA;
  }

  // Calculate histogram
  const histogram = macdLine - signalEMA;

  // Determine bullish/bearish
  const isBullish = macdLine > signalEMA;
  const isBearish = macdLine < signalEMA;

  const newState: MACDState = {
    fastEMA,
    slowEMA,
    macdLine,
    signalEMA,
    fastPeriod,
    slowPeriod,
    signalPeriod,
  };

  return {
    value: {
      macd: macdLine,
      signal: signalEMA,
      histogram,
      isBullish,
      isBearish,
    },
    state: newState,
  };
}

/**
 * MACD Calculator
 */
export class MACDCalculator implements IndicatorCalculator {
  readonly name = 'macd' as const;
  private readonly fastPeriod: number;
  private readonly slowPeriod: number;
  private readonly signalPeriod: number;
  private state: MACDState | null = null;

  constructor(
    fastPeriod: number = DEFAULT_FAST_PERIOD,
    slowPeriod: number = DEFAULT_SLOW_PERIOD,
    signalPeriod: number = DEFAULT_SIGNAL_PERIOD
  ) {
    this.fastPeriod = fastPeriod;
    this.slowPeriod = slowPeriod;
    this.signalPeriod = signalPeriod;
  }

  calculate(
    candles: readonly Candle[],
    index: number,
    _previous?: IndicatorResult
  ): IndicatorResult {
    const result = calculateMACD(
      candles,
      index,
      this.fastPeriod,
      this.slowPeriod,
      this.signalPeriod,
      this.state ?? undefined
    );

    this.state = result.state;

    if (result.value === null) {
      return {
        name: this.name,
        value: null,
        fields: {
          macd: null,
          signal: null,
          histogram: null,
          isBullish: 0,
          isBearish: 0,
        },
        ready: false,
      };
    }

    return {
      name: this.name,
      value: result.value.macd,
      fields: {
        macd: result.value.macd,
        signal: result.value.signal,
        histogram: result.value.histogram,
        isBullish: result.value.isBullish ? 1 : 0,
        isBearish: result.value.isBearish ? 1 : 0,
      },
      ready: true,
    };
  }

  minCandles(): number {
    // Need slowPeriod for MACD line, plus signalPeriod for signal line
    return this.slowPeriod + this.signalPeriod - 1;
  }

  reset(): void {
    this.state = null;
  }
}

/**
 * Check if MACD is bullish (MACD > signal)
 */
export function isMACDBullish(macd: number | null, signal: number | null): boolean {
  if (macd === null || signal === null) return false;
  return macd > signal;
}

/**
 * Check if MACD is bearish (MACD < signal)
 */
export function isMACDBearish(macd: number | null, signal: number | null): boolean {
  if (macd === null || signal === null) return false;
  return macd < signal;
}

/**
 * Check for MACD bullish cross (MACD crosses above signal)
 */
export function isMACDBullishCross(
  currentMACD: number | null,
  currentSignal: number | null,
  prevMACD: number | null,
  prevSignal: number | null
): boolean {
  if (currentMACD === null || currentSignal === null || prevMACD === null || prevSignal === null) {
    return false;
  }
  return prevMACD <= prevSignal && currentMACD > currentSignal;
}

/**
 * Check for MACD bearish cross (MACD crosses below signal)
 */
export function isMACDBearishCross(
  currentMACD: number | null,
  currentSignal: number | null,
  prevMACD: number | null,
  prevSignal: number | null
): boolean {
  if (currentMACD === null || currentSignal === null || prevMACD === null || prevSignal === null) {
    return false;
  }
  return prevMACD >= prevSignal && currentMACD < currentSignal;
}
