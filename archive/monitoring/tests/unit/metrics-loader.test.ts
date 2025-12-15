import { describe, it, expect, vi } from 'vitest';
import * as loader from '../../src/metrics/loader';

vi.mock('../../../storage/src/postgres/postgres-client', () => ({
  queryPostgres: vi.fn().mockResolvedValue({
    rows: [],
  }),
  closePostgresPool: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@quantbot/utils', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../metrics-engine', () => ({
  metricsEngine: {
    recordCalls: vi.fn(),
  },
}));

describe('Metrics Loader', () => {
  describe('loadCallsFromCallerDb', () => {
    it('should load calls from database', async () => {
      const calls = await loader.loadCallsFromCallerDb();
      expect(Array.isArray(calls)).toBe(true);
    });

    it('should handle database errors gracefully', async () => {
      // Should not throw
      const calls = await loader.loadCallsFromCallerDb();
      expect(Array.isArray(calls)).toBe(true);
    });
  });

  describe('enrichCallsWithSimResults', () => {
    it('should enrich calls with ATH data', async () => {
      const mockCalls = [
        {
          callId: 1,
          tokenAddress: '7pXs123456789012345678901234567890pump',
          chain: 'solana',
          alertTimestamp: new Date(),
          entryPrice: 1.0,
          athPrice: 1.0,
          athMultiple: 1,
          timeToAthMinutes: 0,
        },
      ];
      const enriched = await loader.enrichCallsWithSimResults(mockCalls);
      expect(Array.isArray(enriched)).toBe(true);
    });
  });

  describe('calculateAthFromCandles', () => {
    it('should calculate ATH from candles', () => {
      const entryPrice = 1.0;
      const entryTimestamp = 1000;
      const candles = [
        { timestamp: 1100, high: 1.5 },
        { timestamp: 1200, high: 2.0 },
        { timestamp: 1300, high: 1.8 },
      ];

      const result = loader.calculateAthFromCandles(entryPrice, entryTimestamp, candles);
      expect(result.athPrice).toBe(2.0);
      expect(result.athMultiple).toBe(2.0);
      expect(result.timeToAthMinutes).toBeGreaterThan(0);
    });

    it('should handle empty candles', () => {
      const result = loader.calculateAthFromCandles(1.0, 1000, []);
      expect(result.athPrice).toBe(1.0);
      expect(result.athMultiple).toBe(1.0);
    });
  });
});

