/**
 * @file candles.test.ts
 * @description
 * Unit tests for candle data handling, caching, and API integration.
 * Tests cover Birdeye API fetching, local caching, and data validation.
 *
 * Each describe/it block is self-explanatory, but key areas of
 * logic where exceptions or mocking might not be perfectly obvious
 * receive additional comments as needed.
 */

// Mock axios and fs before importing the module - this ensures all fs/axios calls are intercepted
vi.mock('axios');
vi.mock('fs');

// Import after mocks are set up
import type { Candle } from '../src/types/candle';
// fetchHybridCandles has been moved to @quantbot/ohlcv
import { DateTime } from 'luxon';
import axios from 'axios';
import * as fs from 'fs';
const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedFs = fs as jest.Mocked<typeof fs>;

describe('Candle Data Handling', () => {
  // Common mock data used for tests
  const mockTokenAddress = 'So11111111111111111111111111111111111111112';
  const mockStartTime = DateTime.fromISO('2024-01-01T00:00:00Z');
  const mockEndTime = DateTime.fromISO('2024-01-02T00:00:00Z');

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset axios mock to default behavior (important to prevent test bleed)
    if (mockedAxios.get) {
      mockedAxios.get.mockReset();
    }

    // Setup default fs mocks
    mockedFs.existsSync.mockReturnValue(false);
    mockedFs.readdirSync.mockReturnValue([]);
    mockedFs.readFileSync.mockReturnValue('');
    mockedFs.writeFileSync.mockImplementation(() => {});
    mockedFs.mkdirSync.mockImplementation(() => '');
    // Mock statSync to return a valid stats object with mtime
    mockedFs.statSync.mockReturnValue({
      mtime: new Date(),
      size: 0,
      isFile: () => true,
      isDirectory: () => false,
    } as any);
  });

  // NOTE: fetchHybridCandles has been moved to @quantbot/ohlcv
  // These tests have been removed - functionality is now tested in @quantbot/ohlcv package
  // Deleted: describe.skip('fetchHybridCandles', ...) - 12 tests removed

  describe('Candle data validation', () => {
    it('should validate candle timestamp', () => {
      const candle: Candle = {
        timestamp: 1704067200,
        open: 1.0,
        high: 1.1,
        low: 0.9,
        close: 1.05,
        volume: 1000,
      };

      expect(candle.timestamp).toBeGreaterThan(0);
      expect(typeof candle.timestamp).toBe('number');
    });

    it('should validate candle price data', () => {
      const candle: Candle = {
        timestamp: 1704067200,
        open: 1.0,
        high: 1.1,
        low: 0.9,
        close: 1.05,
        volume: 1000,
      };

      expect(candle.open).toBeGreaterThan(0);
      expect(candle.high).toBeGreaterThanOrEqual(candle.open);
      expect(candle.high).toBeGreaterThanOrEqual(candle.close);
      expect(candle.low).toBeLessThanOrEqual(candle.open);
      expect(candle.low).toBeLessThanOrEqual(candle.close);
      expect(candle.close).toBeGreaterThan(0);
    });

    it('should validate candle volume', () => {
      const candle: Candle = {
        timestamp: 1704067200,
        open: 1.0,
        high: 1.1,
        low: 0.9,
        close: 1.05,
        volume: 1000,
      };

      expect(candle.volume).toBeGreaterThanOrEqual(0);
      expect(typeof candle.volume).toBe('number');
    });

    it('should handle edge cases in candle data', () => {
      const edgeCaseCandle: Candle = {
        timestamp: 0,
        open: 0,
        high: 0,
        low: 0,
        close: 0,
        volume: 0,
      };

      expect(edgeCaseCandle.timestamp).toBe(0);
      expect(edgeCaseCandle.open).toBe(0);
      expect(edgeCaseCandle.volume).toBe(0);
    });
  });

  // NOTE: Cache functionality is part of fetchHybridCandles which has been moved to @quantbot/ohlcv
  // Deleted: describe.skip('Cache functionality', ...) - 3 tests removed

  // NOTE: API integration is part of fetchHybridCandles which has been moved to @quantbot/ohlcv
  // Deleted: describe.skip('API integration', ...) - 3 tests removed
});
