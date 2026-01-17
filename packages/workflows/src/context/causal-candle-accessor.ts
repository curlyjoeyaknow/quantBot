/**
 * Storage-Based Causal Candle Accessor
 *
 * Implements CausalCandleAccessor using StorageEngine.
 * Ensures Gate 2 compliance: only candles with closeTime <= simulationTime are accessible.
 */

import { DateTime } from 'luxon';
import type { ClockPort } from '@quantbot/core';
import type { StorageEngine } from '@quantbot/infra/storage';
import type { CausalCandleAccessor, Candle, CandleInterval } from '@quantbot/simulation';
import { filterCandlesByCloseTimeInterval, getLastClosedCandleInterval } from '@quantbot/simulation';

/**
 * Cache entry for candles
 */
interface CandleCacheEntry {
  candles: Candle[];
  mint: string;
  interval: CandleInterval;
  timeWindow: { start: number; end: number };
  timestamp: number; // Cache creation time
}

/**
 * Storage-based causal candle accessor
 *
 * Wraps StorageEngine and provides causal access to candles.
 * Implements caching to reduce repeated queries within lookback window.
 */
export class StorageCausalCandleAccessor implements CausalCandleAccessor {
  private readonly cache: Map<string, CandleCacheEntry> = new Map();
  private readonly cacheTTL: number = 60_000; // 60 seconds cache TTL

  constructor(
    private readonly storageEngine: StorageEngine,
    private readonly clock: ClockPort,
    private readonly defaultInterval: CandleInterval = '5m',
    private readonly chain: string = 'solana'
  ) {}

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
  async getCandlesAtTime(
    mint: string,
    simulationTime: number,
    lookback: number,
    interval: CandleInterval
  ): Promise<Candle[]> {
    const lookbackStart = simulationTime - lookback;
    const simulationTimeDT = DateTime.fromSeconds(simulationTime);
    const lookbackStartDT = DateTime.fromSeconds(lookbackStart);

    // Check cache first
    const cacheKey = this.getCacheKey(mint, interval, lookbackStart, simulationTime);
    const cached = this.cache.get(cacheKey);
    if (cached && this.isCacheValid(cached, simulationTime)) {
      // Filter by close time (causal gate) - cache may have future candles
      return filterCandlesByCloseTimeInterval(cached.candles, simulationTime, interval);
    }

    // Query candles from storage
    const allCandles = await this.storageEngine.getCandles(
      mint,
      this.chain,
      lookbackStartDT,
      simulationTimeDT,
      { interval }
    );

    // Filter by close time (causal gate)
    const closedCandles = filterCandlesByCloseTimeInterval(allCandles, simulationTime, interval);

    // Update cache
    this.cache.set(cacheKey, {
      candles: allCandles, // Cache all candles (may include future ones)
      mint,
      interval,
      timeWindow: { start: lookbackStart, end: simulationTime },
      timestamp: this.clock.nowMs(),
    });

    // Clean up expired cache entries
    this.cleanupCache();

    return closedCandles;
  }

  /**
   * Get the last closed candle at simulation time t
   *
   * @param mint - Token mint address
   * @param simulationTime - Current simulation time (Unix timestamp in seconds)
   * @param interval - Candle interval
   * @returns The last closed candle, or null if none available
   */
  async getLastClosedCandle(
    mint: string,
    simulationTime: number,
    interval: CandleInterval
  ): Promise<Candle | null> {
    // Use a reasonable lookback window (e.g., 1 hour) to find last closed candle
    const lookback = 3600; // 1 hour
    const candles = await this.getCandlesAtTime(mint, simulationTime, lookback, interval);
    return getLastClosedCandleInterval(candles, simulationTime, interval);
  }

  /**
   * Generate cache key
   */
  private getCacheKey(
    mint: string,
    interval: CandleInterval,
    startTime: number,
    endTime: number
  ): string {
    return `${mint}:${interval}:${startTime}:${endTime}`;
  }

  /**
   * Check if cache entry is still valid
   */
  private isCacheValid(entry: CandleCacheEntry, simulationTime: number): boolean {
    const age = this.clock.nowMs() - entry.timestamp;
    if (age > this.cacheTTL) {
      return false;
    }

    // Cache is valid if simulationTime is within cached window
    return simulationTime >= entry.timeWindow.start && simulationTime <= entry.timeWindow.end;
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupCache(): void {
    const now = this.clock.nowMs();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.cacheTTL) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cache entries (useful for testing)
   */
  clearCache(): void {
    this.cache.clear();
  }
}
