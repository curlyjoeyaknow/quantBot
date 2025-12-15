/**
 * @file candles.test.ts
 * @description
 * Unit tests for the hybrid candle-fetching logic, including fetching, error handling,
 * data validation, and compatibility with multiple blockchains.
 *
 * This file mocks axios and fs to isolate candle-fetching network behavior,
 * and validates that candle fields are handled robustly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';

// Mock axios - define mock function inside factory to avoid hoisting issues
vi.mock('axios', async () => {
  const { vi } = await import('vitest');
  const mockAxiosGet = vi.fn();
  return {
    default: {
      get: mockAxiosGet,
    },
    get: mockAxiosGet,
  };
});

// Mock fs
vi.mock('fs', async () => {
  const { vi } = await import('vitest');
  const mockExistsSync = vi.fn(() => false);
  const mockReadFileSync = vi.fn();
  const mockWriteFileSync = vi.fn();
  const mockMkdirSync = vi.fn();
  const mockReaddirSync = vi.fn(() => []);
  const mockStatSync = vi.fn(() => ({ mtime: new Date() }));
  const mockUnlinkSync = vi.fn();
  const mockCreateWriteStream = vi.fn(() => ({
    write: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    emit: vi.fn(),
    pipe: vi.fn(),
  }));

  return {
    default: {
      existsSync: mockExistsSync,
      readFileSync: mockReadFileSync,
      writeFileSync: mockWriteFileSync,
      mkdirSync: mockMkdirSync,
      readdirSync: mockReaddirSync,
      statSync: mockStatSync,
      unlinkSync: mockUnlinkSync,
      createWriteStream: mockCreateWriteStream,
      promises: {
        readFile: vi.fn(),
        writeFile: vi.fn(),
        mkdir: vi.fn(),
        readdir: vi.fn(() => Promise.resolve([])),
        stat: vi.fn(() => Promise.resolve({ mtime: new Date() })),
        unlink: vi.fn(),
      },
    },
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    mkdirSync: mockMkdirSync,
    readdirSync: mockReaddirSync,
    statSync: mockStatSync,
    unlinkSync: mockUnlinkSync,
    createWriteStream: mockCreateWriteStream,
  };
});

// Mock ClickHouse client - mock the relative import path used in candles.ts
vi.mock('../../storage/src/clickhouse-client', () => ({
  queryCandles: vi.fn().mockResolvedValue([]),
  insertCandles: vi.fn().mockResolvedValue(undefined),
}));

import { fetchHybridCandles, Candle } from '../src/candles';
import axios from 'axios';

describe('Candle Data Handling', () => {
  // Standard fixtures for tests
  const mockTokenAddress = 'So11111111111111111111111111111111111111112';
  const mockStartTime = DateTime.fromISO('2024-01-01T00:00:00Z');
  const mockEndTime = DateTime.fromISO('2024-01-02T00:00:00Z');

  /**
   * Resets mocks before each test to ensure test isolation.
   */
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset axios mock - access via axios.get
    vi.mocked(axios.get).mockReset();
  });

  describe('fetchHybridCandles', () => {
    /**
     * Should fetch and parse candles as expected from the Birdeye API for Solana.
     * Verifies: numeric conversion, prop presence, and correct number of items.
     */
    it('should fetch candles successfully for Solana', async () => {
      const mockResponse = {
        status: 200,
        data: {
          success: true,
          data: {
            items: [
              {
                unix_time: 1704067200,
                o: '1.0',
                h: '1.1',
                l: '0.9',
                c: '1.05',
                v: '1000',
              },
              {
                unix_time: 1704070800,
                o: '1.05',
                h: '1.2',
                l: '1.0',
                c: '1.15',
                v: '1200',
              },
            ],
          },
        },
      };

      // Ensure USE_CACHE_ONLY is not set
      const originalCacheOnly = process.env.USE_CACHE_ONLY;
      delete process.env.USE_CACHE_ONLY;

      try {
        // Mock axios calls:
        // 1. First call (range mode) returns empty items, so it tries limit mode
        // 2. Second call (limit mode) returns the mock data
        vi.mocked(axios.get).mockResolvedValueOnce({
          status: 200,
          data: { data: { items: [] } },
        } as any);
        vi.mocked(axios.get).mockResolvedValueOnce(mockResponse as any);

        const result = await fetchHybridCandles(
          mockTokenAddress,
          mockStartTime,
          mockEndTime,
          'solana'
        );

        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({
          timestamp: 1704067200,
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        });
      } finally {
        // Restore original value
        if (originalCacheOnly) {
          process.env.USE_CACHE_ONLY = originalCacheOnly;
        }
      }
    });

    /**
     * Should fetch candles for Ethereum and verify correct API call headers.
     */
    it('should fetch candles successfully for Ethereum', async () => {
      const mockResponse = {
        status: 200,
        data: {
          success: true,
          data: {
            items: [
              {
                unix_time: 1704067200,
                o: '1.0',
                h: '1.1',
                l: '0.9',
                c: '1.05',
                v: '1000',
              },
            ],
          },
        },
      };

      // Ensure USE_CACHE_ONLY is not set
      const originalCacheOnly = process.env.USE_CACHE_ONLY;
      delete process.env.USE_CACHE_ONLY;

      try {
        // Mock axios calls: range mode returns empty, limit mode returns data
        vi.mocked(axios.get).mockResolvedValueOnce({
          status: 200,
          data: { data: { items: [] } },
        } as any);
        vi.mocked(axios.get).mockResolvedValueOnce(mockResponse as any);

        const result = await fetchHybridCandles(
          mockTokenAddress,
          mockStartTime,
          mockEndTime,
          'ethereum'
        );

        expect(result).toBeDefined();
        expect(result.length).toBe(1);
        expect(axios.get).toHaveBeenCalledWith(
          expect.stringContaining('birdeye.so'),
          expect.objectContaining({
            headers: expect.objectContaining({
              'x-chain': 'ethereum',
            }),
          })
        );
      } finally {
        if (originalCacheOnly) {
          process.env.USE_CACHE_ONLY = originalCacheOnly;
        }
      }
    });

    /**
     * Simulates an API error (e.g., network or server failure).
     * The promise should reject with the "API Error".
     */
    it('should handle API errors gracefully', async () => {
      // Ensure USE_CACHE_ONLY is not set
      const originalCacheOnly = process.env.USE_CACHE_ONLY;
      delete process.env.USE_CACHE_ONLY;

      try {
        // Mock range mode to return empty, then limit mode to throw error
        vi.mocked(axios.get).mockResolvedValueOnce({
          status: 200,
          data: { data: { items: [] } },
        } as any);
        vi.mocked(axios.get).mockRejectedValueOnce(new Error('API Error'));

        await expect(
          fetchHybridCandles(mockTokenAddress, mockStartTime, mockEndTime, 'solana')
        ).rejects.toThrow('API Error');
      } finally {
        if (originalCacheOnly) {
          process.env.USE_CACHE_ONLY = originalCacheOnly;
        }
      }
    });

    /**
     * Should handle cases where the API response contains no candle data (empty items array).
     */
    it('should handle empty response data', async () => {
      const mockResponse = {
        status: 200,
        data: {
          success: true,
          data: {
            items: [],
          },
        },
      };

      // Mock both axios calls: limit check and range fetch
      vi.mocked(axios.get).mockResolvedValueOnce({ status: 404, data: {} } as any); // Limit check fails
      vi.mocked(axios.get).mockResolvedValueOnce(mockResponse as any); // Range fetch succeeds

      const result = await fetchHybridCandles(
        mockTokenAddress,
        mockStartTime,
        mockEndTime,
        'solana'
      );

      expect(result).toEqual([]);
    });

    /**
     * Should handle cases where API signals failure (success: false),
     * for example when the token is not found.
     */
    it('should handle unsuccessful API response', async () => {
      const mockResponse = {
        status: 200,
        data: {
          success: false,
          message: 'Token not found',
        },
      };

      // Mock both axios calls: limit check and range fetch
      vi.mocked(axios.get).mockResolvedValueOnce({ status: 404, data: {} } as any); // Limit check fails
      vi.mocked(axios.get).mockResolvedValueOnce(mockResponse as any); // Range fetch succeeds

      const result = await fetchHybridCandles(
        mockTokenAddress,
        mockStartTime,
        mockEndTime,
        'solana'
      );

      expect(result).toEqual([]);
    });

    /**
     * Should correctly set the x-chain header for all supported chains.
     * Ensures we test each chain variant supported in our hybrid fetcher.
     */
    it('should handle different chain types', async () => {
      const chains = ['solana', 'ethereum', 'bsc', 'base'];

      for (const chain of chains) {
        const mockResponse = {
          status: 200,
          data: {
            success: true,
            data: { items: [] },
          },
        };

        // Mock both axios calls: limit check and range fetch
        vi.mocked(axios.get).mockResolvedValueOnce({ status: 404, data: {} } as any); // Limit check fails
        vi.mocked(axios.get).mockResolvedValueOnce(mockResponse as any); // Range fetch succeeds

        await fetchHybridCandles(mockTokenAddress, mockStartTime, mockEndTime, chain);

        expect(axios.get).toHaveBeenCalledWith(
          expect.stringContaining('birdeye.so'),
          expect.objectContaining({
            headers: expect.objectContaining({
              'x-chain': chain,
            }),
          })
        );
      }
    });

    /**
     * Ensures the function does not crash on malformed numeric candle properties,
     * such as a string that can't be parsed to a number.
     */
    it('should handle malformed candle data', async () => {
      const mockResponse = {
        status: 200,
        data: {
          success: true,
          data: {
            items: [
              {
                unix_time: 1704067200,
                o: 'invalid',
                h: '1.1',
                l: '0.9',
                c: '1.05',
                v: '1000',
              },
            ],
          },
        },
      };

      // Ensure USE_CACHE_ONLY is not set
      const originalCacheOnly = process.env.USE_CACHE_ONLY;
      delete process.env.USE_CACHE_ONLY;

      try {
        // Mock range mode returns empty, limit mode returns malformed data
        vi.mocked(axios.get).mockResolvedValueOnce({
          status: 200,
          data: { data: { items: [] } },
        } as any);
        vi.mocked(axios.get).mockResolvedValueOnce(mockResponse as any);

        const result = await fetchHybridCandles(
          mockTokenAddress,
          mockStartTime,
          mockEndTime,
          'solana'
        );

        expect(result).toBeDefined();
        expect(result.length).toBe(1);
        expect(result[0].open).toBeNaN();
      } finally {
        if (originalCacheOnly) {
          process.env.USE_CACHE_ONLY = originalCacheOnly;
        }
      }
    });

    /**
     * Handles the case where some required candle props are missing from the API.
     * Should parse missing numerics as NaN, but not crash.
     */
    it('should handle missing candle properties', async () => {
      const mockResponse = {
        status: 200,
        data: {
          success: true,
          data: {
            items: [
              {
                unix_time: 1704067200,
                o: '1.0',
                // Missing h, l, c, v
              },
            ],
          },
        },
      };

      // Ensure USE_CACHE_ONLY is not set
      const originalCacheOnly = process.env.USE_CACHE_ONLY;
      delete process.env.USE_CACHE_ONLY;

      try {
        // Mock range mode returns empty, limit mode returns data with missing properties
        vi.mocked(axios.get).mockResolvedValueOnce({
          status: 200,
          data: { data: { items: [] } },
        } as any);
        vi.mocked(axios.get).mockResolvedValueOnce(mockResponse as any);

        const result = await fetchHybridCandles(
          mockTokenAddress,
          mockStartTime,
          mockEndTime,
          'solana'
        );

        expect(result).toBeDefined();
        expect(result.length).toBe(1);
        expect(result[0].high).toBeNaN();
        expect(result[0].low).toBeNaN();
        expect(result[0].close).toBeNaN();
        expect(result[0].volume).toBeNaN();
      } finally {
        if (originalCacheOnly) {
          process.env.USE_CACHE_ONLY = originalCacheOnly;
        }
      }
    });
  });

  describe('Candle data validation', () => {
    /**
     * Checks that the timestamp on a candle object is present and valid.
     */
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

    /**
     * Checks that all candle price fields meet general requirements:
     * positive values, correct bounds relationships between o/h/l/c.
     */
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

    /**
     * Validates that volume is a non-negative number.
     */
    it('should validate candle volume', () => {
      const candle: Candle = {
        timestamp: 1704067200,
        open: 1.0,
        high: 1.1,
        low: 0.9,
        close: 1.05,
        volume: 1000,
      };

      expect(typeof candle.volume).toBe('number');
      expect(candle.volume).toBeGreaterThanOrEqual(0);
    });
  });
});
