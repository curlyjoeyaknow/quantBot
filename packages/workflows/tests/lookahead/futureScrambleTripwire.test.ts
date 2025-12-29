/**
 * Future-Scramble Tripwire Test
 *
 * CRITICAL: This test proves that the causal accessor cannot accidentally peek forward.
 *
 * If the accessor is truly causal, then:
 * - Mutating candles after cutoff T should NOT affect reads before T
 * - This test detects leakage by behavior, not by code review
 *
 * This is the simplest, highest-leverage anti–look-ahead guardrail.
 */

import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { StorageCausalCandleAccessor } from '../../src/context/causal-candle-accessor.js';
import type { StorageEngine } from '@quantbot/storage';
import type { ClockPort } from '@quantbot/core';
import type { Candle, CandleInterval } from '@quantbot/simulation';

// Minimal StorageEngine shape required by StorageCausalCandleAccessor
type FakeStorageEngine = {
  getCandles: (
    mint: string,
    chain: string,
    startTime: DateTime,
    endTime: DateTime,
    options?: { interval?: CandleInterval }
  ) => Promise<Candle[]>;
};

function makeCandles({
  startTimestampSeconds,
  tfSeconds,
  count,
  basePrice = 100,
}: {
  startTimestampSeconds: number;
  tfSeconds: number;
  count: number;
  basePrice?: number;
}): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const timestamp = startTimestampSeconds + i * tfSeconds;
    const p = basePrice + i;
    out.push({
      timestamp,
      open: p,
      high: p + 0.5,
      low: p - 0.5,
      close: p + 0.25,
      volume: 1000 + i,
    });
  }
  return out;
}

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

describe('Look-ahead tripwire: future-scramble must not affect past candle reads', () => {
  it('getLastClosedCandle before cutoff T is invariant to mutations after T', async () => {
    const mint = 'TEST_MINT';
    const timeframe: CandleInterval = '5m';
    const tfMs = 5 * 60 * 1000; // 5 minutes in milliseconds
    const tfSeconds = 5 * 60; // 5 minutes in seconds

    // Build 120 minutes of candles (24 candles at 5m interval)
    // Start at a fixed Unix timestamp (e.g., 1000000 seconds)
    const startTimestampSeconds = 1000000;
    const candles = makeCandles({
      startTimestampSeconds,
      tfSeconds,
      count: 24,
      basePrice: 100,
    });

    // Cutoff time T: after 60 minutes (i.e., at tsOpen=60m boundary = 12 candles)
    // Decision time = candle close time (timestamp + interval)
    // For candle at 60m open (timestamp = start + 12*300), close time = timestamp + 300
    // Cutoff decision time = start + 12*300 + 300 = start + 13*300
    const cutoffDecisionTime = startTimestampSeconds + 13 * tfSeconds;

    // Store original candles for mutation
    const mutableCandles = deepClone(candles);

    // Fake storage returns candles in [startTime, endTime] by timestamp
    const storage: FakeStorageEngine = {
      async getCandles(
        mint: string,
        chain: string,
        startTime: DateTime,
        endTime: DateTime,
        options?: { interval?: CandleInterval }
      ) {
        const startSeconds = Math.floor(startTime.toSeconds());
        const endSeconds = Math.floor(endTime.toSeconds());
        return mutableCandles.filter(
          (c) => c.timestamp >= startSeconds && c.timestamp <= endSeconds
        );
      },
    };

    // Fake clock (not used in this test but required by constructor)
    const clock: ClockPort = {
      nowMs: () => Date.now(),
    };

    const accessor = new StorageCausalCandleAccessor(
      storage as unknown as StorageEngine,
      clock,
      timeframe,
      'solana'
    );

    // Query a bunch of "decision times" strictly before cutoffT
    // Decision time = candle close time (timestamp + interval)
    // For 5m candles: decision at 5m, 10m, 15m, ..., 60m (12 decision points)
    // Each candle's close time = timestamp + 300 seconds
    const decisionTimes = Array.from({ length: 12 }, (_, i) => {
      // Candle i opens at start + i*300, closes at start + (i+1)*300
      return startTimestampSeconds + (i + 1) * tfSeconds;
    });

    const before = [];
    for (const tDecision of decisionTimes) {
      const c = await accessor.getLastClosedCandle(mint, tDecision, timeframe);
      before.push(c ? deepClone(c) : null);
    }

    // Scramble all candles *after* cutoffT: mutate close/high/low/volume etc.
    // If the accessor is causal, reads before cutoffT must not change.
    for (const c of mutableCandles) {
      // Candle is "after cutoff" if its close time (timestamp + interval) > cutoffDecisionTime
      const candleCloseTime = c.timestamp + tfSeconds;
      if (candleCloseTime > cutoffDecisionTime) {
        c.close = c.close + 9999;
        c.high = c.high + 9999;
        c.low = c.low + 9999;
        c.volume = c.volume + 9999;
      }
    }

    // Clear cache and create new accessor instance to ensure no caching affects the test
    accessor.clearCache();
    const accessor2 = new StorageCausalCandleAccessor(
      storage as unknown as StorageEngine,
      clock,
      timeframe,
      'solana'
    );

    const after = [];
    for (const tDecision of decisionTimes) {
      const c = await accessor2.getLastClosedCandle(mint, tDecision, timeframe);
      after.push(c ? deepClone(c) : null);
    }

    // CRITICAL ASSERTION: Results before and after scrambling must be identical
    expect(after).toEqual(before);
  });
});
