/**
 * Causal Candle Accessor
 *
 * Gate 2: At simulation time t, it must be impossible to fetch candles with close_time > t.
 * This ensures causal correctness - simulations cannot see future data.
 */

import type { Candle } from './candle.js';
import { getIntervalSeconds, type CandleInterval } from './candle.js';

/**
 * Get the close time of a candle
 *
 * A candle's close time is timestamp + intervalSeconds.
 * The candle is only available after it closes.
 *
 * @param candle - The candle
 * @param intervalSeconds - The candle interval in seconds (default: 300 for 5m)
 * @returns The close time in seconds (Unix timestamp)
 */
export function getCandleCloseTime(candle: Candle, intervalSeconds: number = 300): number {
  return candle.timestamp + intervalSeconds;
}

/**
 * Get the close time of a candle from an interval string
 *
 * @param candle - The candle
 * @param interval - The candle interval string (e.g., '5m', '1h')
 * @returns The close time in seconds (Unix timestamp)
 */
export function getCandleCloseTimeFromInterval(candle: Candle, interval: CandleInterval): number {
  const intervalSeconds = getIntervalSeconds(interval);
  return getCandleCloseTime(candle, intervalSeconds);
}

/**
 * Filter candles to only include those closed at or before the given time
 *
 * @param candles - Array of candles to filter
 * @param simulationTime - Current simulation time (Unix timestamp in seconds)
 * @param intervalSeconds - The candle interval in seconds (default: 300 for 5m)
 * @returns Filtered candles array
 */
export function filterCandlesByCloseTime(
  candles: readonly Candle[],
  simulationTime: number,
  intervalSeconds: number = 300
): Candle[] {
  return candles.filter((candle) => {
    const closeTime = getCandleCloseTime(candle, intervalSeconds);
    return closeTime <= simulationTime;
  });
}

/**
 * Filter candles using interval string
 *
 * @param candles - Array of candles to filter
 * @param simulationTime - Current simulation time (Unix timestamp in seconds)
 * @param interval - The candle interval string (e.g., '5m', '1h')
 * @returns Filtered candles array
 */
export function filterCandlesByCloseTimeInterval(
  candles: readonly Candle[],
  simulationTime: number,
  interval: CandleInterval
): Candle[] {
  const intervalSeconds = getIntervalSeconds(interval);
  return filterCandlesByCloseTime(candles, simulationTime, intervalSeconds);
}

/**
 * Get the last closed candle at a given simulation time
 *
 * @param candles - Array of candles (should be sorted by timestamp)
 * @param simulationTime - Current simulation time (Unix timestamp in seconds)
 * @param intervalSeconds - The candle interval in seconds (default: 300 for 5m)
 * @returns The last closed candle, or null if none available
 */
export function getLastClosedCandle(
  candles: readonly Candle[],
  simulationTime: number,
  intervalSeconds: number = 300
): Candle | null {
  const closedCandles = filterCandlesByCloseTime(candles, simulationTime, intervalSeconds);
  if (closedCandles.length === 0) {
    return null;
  }
  // Return the last one (highest timestamp)
  return closedCandles[closedCandles.length - 1] ?? null;
}

/**
 * Get the last closed candle using interval string
 *
 * @param candles - Array of candles (should be sorted by timestamp)
 * @param simulationTime - Current simulation time (Unix timestamp in seconds)
 * @param interval - The candle interval string (e.g., '5m', '1h')
 * @returns The last closed candle, or null if none available
 */
export function getLastClosedCandleInterval(
  candles: readonly Candle[],
  simulationTime: number,
  interval: CandleInterval
): Candle | null {
  const intervalSeconds = getIntervalSeconds(interval);
  return getLastClosedCandle(candles, simulationTime, intervalSeconds);
}

/**
 * Causal candle accessor interface
 *
 * Provides access to candles that respects causality:
 * - Only candles closed at or before simulation time are accessible
 * - Multi-timeframe candles expose last-closed-only
 */
export interface CausalCandleAccessor {
  /**
   * Get candles available at simulation time t
   * Only returns candles where closeTime <= t
   *
   * @param mint - Token mint address
   * @param simulationTime - Current simulation time (Unix timestamp in seconds)
   * @param lookback - How far back to look (seconds)
   * @param interval - Candle interval
   * @returns Array of candles closed at or before simulation time
   */
  getCandlesAtTime(
    mint: string,
    simulationTime: number,
    lookback: number,
    interval: CandleInterval
  ): Promise<Candle[]>;

  /**
   * Get the last closed candle at simulation time t
   *
   * @param mint - Token mint address
   * @param simulationTime - Current simulation time (Unix timestamp in seconds)
   * @param interval - Candle interval
   * @returns The last closed candle, or null if none available
   */
  getLastClosedCandle(
    mint: string,
    simulationTime: number,
    interval: CandleInterval
  ): Promise<Candle | null>;
}

/**
 * Causal candle wrapper
 *
 * Wraps a pre-fetched array of candles and provides causal access.
 * This is useful when candles are already available but need causal filtering.
 */
export class CausalCandleWrapper implements CausalCandleAccessor {
  private readonly candles: readonly Candle[];
  private readonly interval: CandleInterval;

  constructor(candles: readonly Candle[], interval: CandleInterval = '5m') {
    this.candles = candles;
    this.interval = interval;
  }

  async getCandlesAtTime(
    _mint: string,
    simulationTime: number,
    lookback: number,
    interval: CandleInterval
  ): Promise<Candle[]> {
    // Filter by close time
    const closedCandles = filterCandlesByCloseTimeInterval(this.candles, simulationTime, interval);

    // Filter by lookback window
    const lookbackStart = simulationTime - lookback;
    return closedCandles.filter((candle) => candle.timestamp >= lookbackStart);
  }

  async getLastClosedCandle(
    _mint: string,
    simulationTime: number,
    interval: CandleInterval
  ): Promise<Candle | null> {
    return getLastClosedCandleInterval(this.candles, simulationTime, interval);
  }
}
