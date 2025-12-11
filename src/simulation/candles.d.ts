/*******************************************************************************
 * Candle Utilities: Type Definition, Birdeye Fetching, and Local Caching
 *
 * This module provides:
 *   - The Candle type (OHLCV format, normalized for all consumption)
 *   - Robust and upgradeable utilities for fetching token OHLCV data from Birdeye
 *   - A simple yet upgradeable CSV-based cache to optimize API quota and latency
 *
 * Consistent structure, sectioning, and code-level documentation keep this
 * module readable, maintainable, and easily upgradable for future requirements.
 ******************************************************************************/
import { DateTime } from 'luxon';
/**
 * Represents a single OHLCV (Open/High/Low/Close/Volume) candle.
 * All price fields are in quoted currency (e.g., USD). Volume is also quote denom.
 * - timestamp: UNIX timestamp (seconds UTC)
 */
export type Candle = {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
};
/**
 * Supported higher‑level aggregation intervals for derived candles.
 */
export type AggregationInterval = '5m' | '15m' | '1H' | '4H' | '1D';
/**
 * Aggregate lower‑timeframe candles (e.g. 1m / 5m) into higher‑timeframe
 * candles (e.g. 1H) by bucketing on timestamp.
 *
 * Assumptions:
 * - Input candles are sorted ascending by timestamp (seconds).
 * - All candles describe contiguous, non‑overlapping time ranges.
 *
 * The resulting candle for each bucket uses:
 * - open:   first candle's open
 * - close:  last candle's close
 * - high:   max(high)
 * - low:    min(low)
 * - volume: sum(volume)
 */
export declare function aggregateCandles(candles: readonly Candle[], interval: AggregationInterval): Candle[];
/**
 * Fetches candles from Birdeye API with automatic chunking.
 * Exported for use in scripts that need direct access.
 */
export declare function fetchBirdeyeCandlesDirect(mint: string, interval: '15s' | '1m' | '5m' | '1H', from: number, to: number, chain?: string): Promise<Candle[]>;
/**
 * Fetches optimized multi-timeframe candles for maximum granularity and credit efficiency.
 *
 * Strategy (simplified):
 * 1. 1m: 52 hours back (3120 candles) + forward to fill 5000 candles total
 * 2. 15s: 52×15s periods back (13 minutes) + forward to fill 5000 candles total
 * 3. 5m: 52×5m periods back (4.33 hours) + forward in 17-day chunks for remainder
 *
 * This minimizes credit usage while maximizing granularity around alert time.
 *
 * @param mint Token mint address
 * @param alertTime Alert/call time (DateTime)
 * @param endTime End time for candles (DateTime, defaults to now)
 * @param chain Blockchain name (defaults to 'solana')
 * @returns Array of Candle objects, sorted by timestamp
 */
export declare function fetchOptimizedCandlesForAlert(mint: string, alertTime: DateTime, endTime?: DateTime, chain?: string): Promise<Candle[]>;
/**
 * Fetches OHLCV candles for a given token using 5m granularity for the entire period.
 * If alertTime is provided, also fetches 1m candles for 30min before and after alertTime
 * for precise entry pricing.
 *
 * Checks and intelligently extends local CSV cache for quota/performance.
 * Designed for robust upgradeability to any future time partitioning scheme.
 *
 * @param mint      Token mint address
 * @param startTime Range start time (Luxon DateTime, UTC)
 * @param endTime   Range end time   (Luxon DateTime, UTC)
 * @param chain     Blockchain name (defaults to 'solana')
 * @param alertTime Optional alert time - if provided, fetches 1m candles for 30min before/after
 * @returns         Array of Candle objects, ascending by timestamp (merged 5m + 1m if alertTime provided)
 */
export declare function fetchHybridCandles(mint: string, startTime: DateTime, endTime: DateTime, chain?: string, alertTime?: DateTime): Promise<Candle[]>;
//# sourceMappingURL=candles.d.ts.map