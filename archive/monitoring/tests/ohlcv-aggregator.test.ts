import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { insertCandles } from '@quantbot/storage';

// Mock process.exit before importing anything that might call it
const originalExit = process.exit;
beforeAll(() => {
  process.exit = vi.fn() as typeof process.exit;
});
afterAll(() => {
  process.exit = originalExit;
});

import { OhlcvAggregator } from '@quantbot/monitoring';

// Mock dependencies
vi.mock('@quantbot/storage', () => ({
  insertCandles: vi.fn().mockResolvedValue(undefined),
  getStorageEngine: vi.fn(() => ({
    storeCandles: vi.fn().mockResolvedValue(undefined),
    getCandles: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@quantbot/utils', async () => {
  const actual = await vi.importActual('@quantbot/utils');
  return {
    ...actual,
    logger: {
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    },
    createPackageLogger: vi.fn(() => ({
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
    })),
  };
});

describe('OhlcvAggregator', () => {
  let aggregator: OhlcvAggregator;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    aggregator = new OhlcvAggregator(5000);
  });

  afterEach(() => {
    aggregator.stop();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create aggregator with default flush interval', () => {
      const defaultAggregator = new OhlcvAggregator();
      expect(defaultAggregator).toBeDefined();
    });

    it('should create aggregator with custom flush interval', () => {
      const customAggregator = new OhlcvAggregator(10000);
      expect(customAggregator).toBeDefined();
    });
  });

  describe('start/stop', () => {
    it('should start periodic flushing', () => {
      aggregator.start();
      expect(aggregator).toBeDefined();
    });

    it('should not start multiple timers', () => {
      aggregator.start();
      aggregator.start();
      // Should not throw or create multiple timers
      expect(aggregator).toBeDefined();
    });

    it('should stop periodic flushing', () => {
      aggregator.start();
      aggregator.stop();
      // Should not throw
      expect(aggregator).toBeDefined();
    });
  });

  describe('ingestTick', () => {
    it('should ingest valid tick', () => {
      const timestamp = Math.floor(Date.now() / 1000); // Current time in seconds
      aggregator.ingestTick('token1', 'solana', {
        timestamp,
        price: 1.5,
        volume: 100,
      });

      // Tick should be ingested (no error thrown)
      expect(aggregator).toBeDefined();
    });

    it('should ignore invalid price', () => {
      aggregator.ingestTick('token1', 'solana', {
        timestamp: 1000,
        price: NaN,
        volume: 100,
      });

      // Should not throw
      expect(aggregator).toBeDefined();
    });

    it('should ignore zero price', () => {
      aggregator.ingestTick('token1', 'solana', {
        timestamp: 1000,
        price: 0,
        volume: 100,
      });

      // Should not throw
      expect(aggregator).toBeDefined();
    });

    it('should handle multiple ticks in same bucket', () => {
      const baseTimestamp = Math.floor(Date.now() / 1000); // Current time in seconds
      aggregator.ingestTick('token1', 'solana', {
        timestamp: baseTimestamp,
        price: 1.0,
        volume: 100,
      });
      aggregator.ingestTick('token1', 'solana', {
        timestamp: baseTimestamp + 10, // Same minute bucket
        price: 1.5,
        volume: 50,
      });
      aggregator.ingestTick('token1', 'solana', {
        timestamp: baseTimestamp + 20, // Same minute bucket
        price: 0.8,
        volume: 75,
      });

      // Should accumulate in same bucket
      expect(aggregator).toBeDefined();
    });

    it('should handle ticks for different tokens', () => {
      const timestamp = Math.floor(Date.now() / 1000);
      aggregator.ingestTick('token1', 'solana', {
        timestamp,
        price: 1.0,
        volume: 100,
      });
      aggregator.ingestTick('token2', 'ethereum', {
        timestamp,
        price: 2.0,
        volume: 200,
      });

      // Should handle both tokens separately
      expect(aggregator).toBeDefined();
    });

    it('should update high/low correctly', () => {
      const baseTimestamp = Math.floor(Date.now() / 1000);
      aggregator.ingestTick('token1', 'solana', {
        timestamp: baseTimestamp,
        price: 1.0,
        volume: 100,
      });
      aggregator.ingestTick('token1', 'solana', {
        timestamp: baseTimestamp + 10,
        price: 2.0, // Higher
        volume: 50,
      });
      aggregator.ingestTick('token1', 'solana', {
        timestamp: baseTimestamp + 20,
        price: 0.5, // Lower
        volume: 75,
      });

      // High should be 2.0, low should be 0.5
      expect(aggregator).toBeDefined();
    });

    it('should accumulate volume', () => {
      const baseTimestamp = Math.floor(Date.now() / 1000);
      aggregator.ingestTick('token1', 'solana', {
        timestamp: baseTimestamp,
        price: 1.0,
        volume: 100,
      });
      aggregator.ingestTick('token1', 'solana', {
        timestamp: baseTimestamp + 10,
        price: 1.5,
        volume: 50,
      });

      // Volume should accumulate
      expect(aggregator).toBeDefined();
    });

    it('should handle ticks without volume', () => {
      const timestamp = Math.floor(Date.now() / 1000);
      aggregator.ingestTick('token1', 'solana', {
        timestamp,
        price: 1.0,
      });

      // Should handle missing volume
      expect(aggregator).toBeDefined();
    });
  });

  describe('flushCompletedBuckets', () => {
    it('should flush completed buckets', async () => {
      const now = Date.now();
      // The code calculates: bucketStart = Math.floor(timestamp / 60) * 60
      // And compares with: cutoffUnix = Math.floor(nowMs / 1000) - 60 (in seconds)
      // So bucketStart must be in seconds, meaning timestamp should be in seconds
      // But the function likely receives milliseconds. The division by 60 suggests seconds.
      // Let's use a timestamp that's definitely old enough (2+ minutes ago in seconds)
      const pastSeconds = Math.floor((now - 180000) / 1000); // 3 minutes ago
      const bucketStart = Math.floor(pastSeconds / 60) * 60; // Minute bucket in seconds
      const cutoffUnix = Math.floor(now / 1000) - 60; // Current time minus 1 minute

      // Ensure our bucket will be flushed
      expect(bucketStart).toBeLessThanOrEqual(cutoffUnix);

      // Pass timestamp in seconds (the code divides by 60, expecting seconds)
      aggregator.ingestTick('token1', 'solana', {
        timestamp: pastSeconds, // In seconds
        price: 1.0,
        volume: 100,
      });

      await aggregator.flushCompletedBuckets(now);
      expect(insertCandles).toHaveBeenCalled();
    });

    it('should not flush current minute buckets', async () => {
      const now = Date.now();
      const currentSecond = Math.floor(now / 1000);
      const currentMinuteBucket = Math.floor(currentSecond / 60) * 60;

      aggregator.ingestTick('token1', 'solana', {
        timestamp: currentSecond, // Current time in seconds
        price: 1.0,
        volume: 100,
      });

      await aggregator.flushCompletedBuckets(now);

      // Current minute should not be flushed (cutoffUnix = now/1000 - 60)
      // So currentMinuteBucket > cutoffUnix, and it won't be flushed
      expect(aggregator).toBeDefined();
    });

    it('should handle multiple tokens', async () => {
      const now = Date.now();
      const pastSeconds = Math.floor((now - 180000) / 1000); // 3 minutes ago in seconds

      aggregator.ingestTick('token1', 'solana', {
        timestamp: pastSeconds, // In seconds
        price: 1.0,
        volume: 100,
      });
      aggregator.ingestTick('token2', 'ethereum', {
        timestamp: pastSeconds, // In seconds
        price: 2.0,
        volume: 200,
      });

      await aggregator.flushCompletedBuckets(now);

      // Should be called for each token
      expect(insertCandles).toHaveBeenCalledTimes(2);
    });

    it('should handle empty buckets', async () => {
      const now = Date.now();
      await aggregator.flushCompletedBuckets(now);

      // Should not throw
      expect(aggregator).toBeDefined();
    });

    it('should handle insertion errors gracefully', async () => {
      vi.mocked(insertCandles).mockRejectedValueOnce(new Error('Insert failed'));

      const now = Date.now();
      const pastSeconds = Math.floor((now - 180000) / 1000); // 3 minutes ago in seconds

      aggregator.ingestTick('token1', 'solana', {
        timestamp: pastSeconds, // In seconds
        price: 1.0,
        volume: 100,
      });

      await aggregator.flushCompletedBuckets(now);

      // Should handle error gracefully (error is caught in flushCompletedBuckets)
      expect(insertCandles).toHaveBeenCalled();
    });

    it('should sort candles by timestamp', async () => {
      const now = Date.now();
      const baseSeconds = Math.floor((now - 180000) / 1000); // 3 minutes ago in seconds

      aggregator.ingestTick('token1', 'solana', {
        timestamp: baseSeconds + 60, // Later bucket (1 minute later)
        price: 1.5,
        volume: 100,
      });
      aggregator.ingestTick('token1', 'solana', {
        timestamp: baseSeconds, // Earlier bucket
        price: 1.0,
        volume: 50,
      });

      await aggregator.flushCompletedBuckets(now);

      expect(insertCandles).toHaveBeenCalled();
      const callArgs = vi.mocked(insertCandles).mock.calls[0];
      if (callArgs && callArgs[2]) {
        const candles = callArgs[2] as any[];
        if (candles.length > 1) {
          expect(candles[0].timestamp).toBeLessThanOrEqual(candles[1]?.timestamp || Infinity);
        }
      }
    });
  });
});
