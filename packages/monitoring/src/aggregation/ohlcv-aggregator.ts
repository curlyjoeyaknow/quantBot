import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import { insertCandles } from '@quantbot/utils' /* TODO: Fix storage import */;
// TODO: Update to @quantbot/simulation when migrated
import type { Candle } from '@quantbot/simulation/candles';

interface CandleAccumulator {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  startTimestamp: number;
  lastTimestamp: number;
}

type BucketMap = Map<number, CandleAccumulator>;

/**
 * OhlcvAggregator
 * ---------------
 * Aggregates tick-level price updates into canonical 1-minute candles and
 * persists them to ClickHouse. Derived intervals are produced by combining
 * freshly written 1-minute candles to avoid redundant API calls.
 */
export class OhlcvAggregator {
  private readonly buckets: Map<string, BucketMap> = new Map();
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly flushIntervalMs: number;
  private readonly baseIntervalMs: number = 60_000;

  constructor(flushIntervalMs: number = 5_000) {
    this.flushIntervalMs = flushIntervalMs;
  }

  /**
   * Begin periodic flushing of completed buckets.
   */
  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      void this.flushCompletedBuckets(Date.now());
    }, this.flushIntervalMs);
  }

  /**
   * Stop periodic flushing.
   */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Ingest a tick into the in-memory bucket for the token.
   */
  ingestTick(
    tokenAddress: string,
    chain: string,
    tick: { timestamp: number; price: number; volume?: number }
  ): void {
    if (!tick.price || !Number.isFinite(tick.price)) {
      return;
    }

    const key = this.getTokenKey(tokenAddress, chain);
    const bucketStart = Math.floor(tick.timestamp / 60) * 60;
    const buckets = this.getOrCreateBuckets(key);

    const accumulator = buckets.get(bucketStart) ?? {
      open: tick.price,
      high: tick.price,
      low: tick.price,
      close: tick.price,
      volume: 0,
      startTimestamp: bucketStart,
      lastTimestamp: tick.timestamp,
    };

    accumulator.close = tick.price;
    accumulator.high = Math.max(accumulator.high, tick.price);
    accumulator.low = Math.min(accumulator.low, tick.price);
    accumulator.volume += tick.volume ?? 0;
    accumulator.lastTimestamp = tick.timestamp;

    buckets.set(bucketStart, accumulator);
  }

  /**
   * Flush all completed buckets (older than current minute) to ClickHouse.
   */
  async flushCompletedBuckets(nowMs: number): Promise<void> {
    const cutoffUnix = Math.floor(nowMs / 1000) - 60; // keep current minute hot
    const flushPromises: Array<Promise<void>> = [];

    for (const [tokenKey, bucketMap] of this.buckets) {
      const [chain, token] = tokenKey.split(':');
      const readyBuckets = Array.from(bucketMap.entries()).filter(
        ([startTimestamp]) => startTimestamp <= cutoffUnix
      );

      if (!readyBuckets.length) continue;

      const candles: Candle[] = readyBuckets
        .sort((a, b) => a[0] - b[0])
        .map(([startTimestamp, bucket]) => ({
          timestamp: startTimestamp,
          open: bucket.open,
          high: bucket.high,
          low: bucket.low,
          close: bucket.close,
          volume: bucket.volume,
        }));

      readyBuckets.forEach(([startTimestamp]) => bucketMap.delete(startTimestamp));

      flushPromises.push(
        insertCandles(token, chain, candles, '1m').catch((error) => {
          logger.error('Failed to insert aggregated candles', error as Error, {
            token: token.substring(0, 20),
            count: candles.length,
          });
        })
      );
    }

    await Promise.all(flushPromises);
  }

  private getTokenKey(tokenAddress: string, chain: string): string {
    return `${chain}:${tokenAddress}`;
  }

  private getOrCreateBuckets(key: string): BucketMap {
    if (!this.buckets.has(key)) {
      this.buckets.set(key, new Map());
    }
    return this.buckets.get(key)!;
  }
}

export const ohlcvAggregator = new OhlcvAggregator();


