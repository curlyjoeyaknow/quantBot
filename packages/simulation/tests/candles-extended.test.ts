import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { aggregateCandles, fetchHybridCandles } from '../src/candles';
import type { Candle } from '../src/candles';

// Mock axios
vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    statSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    readdirSync: vi.fn().mockReturnValue([]),
  };
});

// Mock logger
vi.mock('../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe('candles-extended', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('aggregateCandles', () => {
    it('should aggregate 5m candles to 1H', () => {
      const candles: Candle[] = [];
      // Create 12 5-minute candles (1 hour total) - align to hour boundary
      const baseTimestamp = Math.floor(1000 / 3600) * 3600; // Round to hour
      for (let i = 0; i < 12; i++) {
        candles.push({
          timestamp: baseTimestamp + i * 300,
          open: 1.0 + i * 0.01,
          high: 1.05 + i * 0.01,
          low: 0.95 + i * 0.01,
          close: 1.02 + i * 0.01,
          volume: 100,
        });
      }

      const aggregated = aggregateCandles(candles, '1H');

      expect(aggregated.length).toBeGreaterThanOrEqual(1);
      expect(aggregated[0].open).toBe(1.0);
      expect(aggregated[0].volume).toBeGreaterThan(0);
    });

    it('should aggregate to 4H intervals', () => {
      const candles: Candle[] = [];
      // Create 48 5-minute candles (4 hours total) - align to 4H boundary
      const baseTimestamp = Math.floor(1000 / (4 * 3600)) * (4 * 3600);
      for (let i = 0; i < 48; i++) {
        candles.push({
          timestamp: baseTimestamp + i * 300,
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.0,
          volume: 100,
        });
      }

      const aggregated = aggregateCandles(candles, '4H');

      expect(aggregated.length).toBeGreaterThanOrEqual(1);
      expect(aggregated[0].volume).toBeGreaterThan(0);
    });

    it('should aggregate to 1D intervals', () => {
      const candles: Candle[] = [];
      // Create 288 5-minute candles (24 hours total) - align to day boundary
      const baseTimestamp = Math.floor(1000 / (24 * 3600)) * (24 * 3600);
      for (let i = 0; i < 288; i++) {
        candles.push({
          timestamp: baseTimestamp + i * 300,
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.0,
          volume: 100,
        });
      }

      const aggregated = aggregateCandles(candles, '1D');

      expect(aggregated.length).toBeGreaterThanOrEqual(1);
      expect(aggregated[0].volume).toBeGreaterThan(0);
    });

    it('should handle empty array', () => {
      const aggregated = aggregateCandles([], '1H');

      expect(aggregated).toEqual([]);
    });

    it('should sort candles before aggregating', () => {
      const candles: Candle[] = [
        { timestamp: 1300, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 100 },
        { timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.0, volume: 100 },
        { timestamp: 1200, open: 1.0, high: 1.1, low: 0.9, close: 1.02, volume: 100 },
      ];

      const aggregated = aggregateCandles(candles, '1H');

      expect(aggregated).toHaveLength(1);
      expect(aggregated[0].open).toBe(1.0); // First candle's open
      expect(aggregated[0].close).toBe(1.05); // Last candle's close
    });

    it('should handle multiple buckets', () => {
      const candles: Candle[] = [];
      // Create 24 5-minute candles (2 hours total) - align to hour boundary
      const baseTimestamp = Math.floor(1000 / 3600) * 3600;
      for (let i = 0; i < 24; i++) {
        candles.push({
          timestamp: baseTimestamp + i * 300,
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.0,
          volume: 100,
        });
      }

      const aggregated = aggregateCandles(candles, '1H');

      expect(aggregated.length).toBeGreaterThanOrEqual(2);
      expect(aggregated[0].volume).toBeGreaterThan(0);
      if (aggregated.length > 1) {
        expect(aggregated[1].volume).toBeGreaterThan(0);
      }
    });

    it('should calculate correct high and low across bucket', () => {
      const baseTimestamp = Math.floor(1000 / 3600) * 3600;
      const candles: Candle[] = [
        { timestamp: baseTimestamp, open: 1.0, high: 1.05, low: 0.95, close: 1.0, volume: 100 },
        {
          timestamp: baseTimestamp + 300,
          open: 1.0,
          high: 1.15,
          low: 0.9,
          close: 1.0,
          volume: 100,
        },
        {
          timestamp: baseTimestamp + 600,
          open: 1.0,
          high: 1.02,
          low: 0.98,
          close: 1.0,
          volume: 100,
        },
      ];

      const aggregated = aggregateCandles(candles, '1H');

      expect(aggregated.length).toBeGreaterThan(0);
      if (aggregated.length > 0) {
        expect(aggregated[0].high).toBeGreaterThanOrEqual(1.15);
        expect(aggregated[0].low).toBeLessThanOrEqual(0.9);
      }
    });
  });

  // Note: fetchHybridCandles tests are complex due to API/cache dependencies
  // These are covered in integration tests
});
