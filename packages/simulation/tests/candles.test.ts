/**
 * @file candles.test.ts
 * @description
 * Unit tests for the hybrid candle-fetching logic, including fetching, error handling,
 * data validation, and compatibility with multiple blockchains.
 * 
 * This file mocks axios and fs to isolate candle-fetching network behavior,
 * and validates that candle fields are handled robustly.
 */

// Mock axios using doMock to ensure it's applied before module loading
const mockAxiosGet = jest.fn();
jest.doMock('axios', () => ({
  __esModule: true,
  default: {
    get: mockAxiosGet
  },
  get: mockAxiosGet
}));

jest.doMock('fs', () => ({
  existsSync: jest.fn(() => false),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  readdirSync: jest.fn(() => []),
  statSync: jest.fn(() => ({ mtime: new Date() })),
  unlinkSync: jest.fn(),
  createWriteStream: jest.fn(() => ({
    write: jest.fn(),
    end: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
    emit: jest.fn(),
    pipe: jest.fn(),
  })),
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    readdir: jest.fn(() => Promise.resolve([])),
    stat: jest.fn(() => Promise.resolve({ mtime: new Date() })),
    unlink: jest.fn()
  }
}));

import { fetchHybridCandles, Candle } from '../../src/simulation/candles';
import { DateTime } from 'luxon';

// Get mocked fs after imports
const mockedFs = require('fs');

describe('Candle Data Handling', () => {
  // Standard fixtures for tests
  const mockTokenAddress = 'So11111111111111111111111111111111111111112';
  const mockStartTime = DateTime.fromISO('2024-01-01T00:00:00Z');
  const mockEndTime = DateTime.fromISO('2024-01-02T00:00:00Z');

  /**
   * Resets mocks before each test to ensure test isolation.
   */
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset axios mock to default behavior
    mockAxiosGet.mockReset();
    // Reset fs mocks
    if (mockedFs.existsSync && typeof mockedFs.existsSync.mockReturnValue === 'function') {
      mockedFs.existsSync.mockReturnValue(false);
    }
    if (mockedFs.readFileSync && typeof mockedFs.readFileSync.mockReturnValue === 'function') {
      mockedFs.readFileSync.mockReturnValue('');
    }
    if (mockedFs.writeFileSync && typeof mockedFs.writeFileSync.mockClear === 'function') {
      mockedFs.writeFileSync.mockClear();
    }
    if (mockedFs.mkdirSync && typeof mockedFs.mkdirSync.mockClear === 'function') {
      mockedFs.mkdirSync.mockClear();
    }
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
                v: '1000'
              },
              {
                unix_time: 1704070800,
                o: '1.05',
                h: '1.2',
                l: '1.0',
                c: '1.15',
                v: '1200'
              }
            ]
          }
        }
      };

      mockAxiosGet.mockResolvedValueOnce(mockResponse);

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
        volume: 1000
      });
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
                v: '1000'
              }
            ]
          }
        }
      };

      mockAxiosGet.mockResolvedValueOnce(mockResponse);

      const result = await fetchHybridCandles(mockTokenAddress, mockStartTime, mockEndTime, 'ethereum');

      expect(result).toBeDefined();
      expect(result.length).toBe(1);
      expect(mockAxiosGet).toHaveBeenCalledWith(
        expect.stringContaining('birdeye.so'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-chain': 'ethereum'
          })
        })
      );
    });

    /**
     * Simulates an API error (e.g., network or server failure).
     * The promise should reject with the "API Error".
     */
    it('should handle API errors gracefully', async () => {
      mockAxiosGet.mockRejectedValueOnce(new Error('API Error'));

      await expect(fetchHybridCandles(mockTokenAddress, mockStartTime, mockEndTime, 'solana'))
        .rejects.toThrow('API Error');
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
            items: []
          }
        }
      };

      mockAxiosGet.mockResolvedValueOnce(mockResponse);

      const result = await fetchHybridCandles(mockTokenAddress, mockStartTime, mockEndTime, 'solana');

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
          message: 'Token not found'
        }
      };

      mockAxiosGet.mockResolvedValueOnce(mockResponse);

      const result = await fetchHybridCandles(mockTokenAddress, mockStartTime, mockEndTime, 'solana');

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
            data: { items: [] }
          }
        };

        mockAxiosGet.mockResolvedValueOnce(mockResponse);

        await fetchHybridCandles(mockTokenAddress, mockStartTime, mockEndTime, chain);

        expect(mockAxiosGet).toHaveBeenCalledWith(
          expect.stringContaining('birdeye.so'),
          expect.objectContaining({
            headers: expect.objectContaining({
              'x-chain': chain
            })
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
                v: '1000'
              }
            ]
          }
        }
      };

      mockAxiosGet.mockResolvedValueOnce(mockResponse);

      const result = await fetchHybridCandles(mockTokenAddress, mockStartTime, mockEndTime, 'solana');

      expect(result).toBeDefined();
      expect(result.length).toBe(1);
      expect(result[0].open).toBeNaN();
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
              }
            ]
          }
        }
      };

      mockAxiosGet.mockResolvedValueOnce(mockResponse);

      const result = await fetchHybridCandles(mockTokenAddress, mockStartTime, mockEndTime, 'solana');

      expect(result).toBeDefined();
      expect(result.length).toBe(1);
      expect(result[0].high).toBeNaN();
      expect(result[0].low).toBeNaN();
      expect(result[0].close).toBeNaN();
      expect(result[0].volume).toBeNaN();
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
        volume: 1000
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
        volume: 1000
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
        volume: 1000
      };

      expect(typeof candle.volume).toBe('number');
      expect(candle.volume).toBeGreaterThanOrEqual(0);
    });
  });
});