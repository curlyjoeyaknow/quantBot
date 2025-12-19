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
  // These tests are skipped as they test functionality that's no longer in this package
  describe.skip('fetchHybridCandles', () => {
    it('should fetch candles successfully for Solana', async () => {
      const mockResponse = {
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

      mockedAxios.get.mockResolvedValueOnce({ ...mockResponse, status: 200 });

      const result = await fetchHybridCandles(
        mockTokenAddress,
        mockStartTime,
        mockEndTime,
        'solana'
      );

      expect(result).toBeDefined();
      expect(result.length).toBe(2);
      expect(result[0]).toEqual({
        timestamp: 1704067200,
        open: 1.0,
        high: 1.1,
        low: 0.9,
        close: 1.05,
        volume: 1000,
      });
    });

    it('should fetch candles successfully for Ethereum', async () => {
      const mockResponse = {
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

      mockedAxios.get.mockResolvedValueOnce({ ...mockResponse, status: 200 });

      const result = await fetchHybridCandles(
        mockTokenAddress,
        mockStartTime,
        mockEndTime,
        'ethereum'
      );

      expect(result).toBeDefined();
      expect(result.length).toBe(1);
      // Ensure the request is sent with correct x-chain in headers
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('birdeye.so'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-chain': 'ethereum',
          }),
        })
      );
    });

    it('should handle API errors gracefully', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('API Error'));

      await expect(
        fetchHybridCandles(mockTokenAddress, mockStartTime, mockEndTime, 'solana')
      ).rejects.toThrow('API Error');
    });

    it('should handle empty response data', async () => {
      const mockResponse = {
        data: {
          success: true,
          data: {
            items: [],
          },
        },
      };

      // Mock both the initial range request and the limit fallback request
      mockedAxios.get.mockResolvedValueOnce({ ...mockResponse, status: 200 });
      mockedAxios.get.mockResolvedValueOnce({ ...mockResponse, status: 200 });

      const result = await fetchHybridCandles(
        mockTokenAddress,
        mockStartTime,
        mockEndTime,
        'solana'
      );

      expect(result).toEqual([]);
    });

    it('should handle unsuccessful API response', async () => {
      const mockResponse = {
        data: {
          success: false,
          message: 'Token not found',
        },
      };

      // Mock both the initial range request and the limit fallback request
      mockedAxios.get.mockResolvedValueOnce({ ...mockResponse, status: 200 });
      mockedAxios.get.mockResolvedValueOnce({ ...mockResponse, status: 200 });

      const result = await fetchHybridCandles(
        mockTokenAddress,
        mockStartTime,
        mockEndTime,
        'solana'
      );

      expect(result).toEqual([]);
    });

    it('should handle different chain types', async () => {
      const chains = ['solana', 'ethereum', 'bsc', 'base'];

      for (const chain of chains) {
        const mockResponse = {
          data: {
            success: true,
            data: { items: [] },
          },
        };

        // Mock both the initial range request and the limit fallback request for each chain
        mockedAxios.get.mockResolvedValueOnce({ ...mockResponse, status: 200 });
        mockedAxios.get.mockResolvedValueOnce({ ...mockResponse, status: 200 });

        await fetchHybridCandles(mockTokenAddress, mockStartTime, mockEndTime, chain);

        // Assert headers sent per chain type
        expect(mockedAxios.get).toHaveBeenCalledWith(
          expect.stringContaining('birdeye.so'),
          expect.objectContaining({
            headers: expect.objectContaining({
              'x-chain': chain,
            }),
          })
        );
      }
    });

    it('should handle malformed candle data', async () => {
      // Provide a candle where "o" is not a number
      const mockResponse = {
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

      mockedAxios.get.mockResolvedValueOnce({ ...mockResponse, status: 200 });

      const result = await fetchHybridCandles(
        mockTokenAddress,
        mockStartTime,
        mockEndTime,
        'solana'
      );

      expect(result).toBeDefined();
      expect(result.length).toBe(1);
      // open parsing should be NaN
      expect(result[0].open).toBeNaN();
    });

    it('should handle missing candle properties', async () => {
      // The candle object is missing several properties
      const mockResponse = {
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

      mockedAxios.get.mockResolvedValueOnce({ ...mockResponse, status: 200 });

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
    });

    it('should use cached data when available', async () => {
      // Simulate cache file present and readable
      const cacheFilename = 'cache_test.csv';
      const cachedData = 'timestamp,open,high,low,close,volume\n1704067200,1.0,1.1,0.9,1.05,1000';

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readdirSync.mockReturnValue([
        {
          name: cacheFilename,
          isFile: () => true,
          isDirectory: () => false,
        } as any,
      ]);
      mockedFs.readFileSync.mockReturnValue(cachedData);
      // Mock statSync to return valid stats with recent mtime (not expired)
      mockedFs.statSync.mockReturnValue({
        mtime: new Date(), // Recent date, so cache is not expired
        size: 0,
        isFile: () => true,
        isDirectory: () => false,
      } as any);

      const result = await fetchHybridCandles(
        mockTokenAddress,
        mockStartTime,
        mockEndTime,
        'solana'
      );

      expect(result).toBeDefined();
      expect(result.length).toBe(1);
      expect(result[0]).toEqual({
        timestamp: 1704067200,
        open: 1.0,
        high: 1.1,
        low: 0.9,
        close: 1.05,
        volume: 1000,
      });
    });

    it('should save candles to cache after fetching', async () => {
      const mockResponse = {
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

      mockedAxios.get.mockResolvedValueOnce({ ...mockResponse, status: 200 });
      mockedFs.existsSync.mockReturnValue(false);

      await fetchHybridCandles(mockTokenAddress, mockStartTime, mockEndTime, 'solana');

      // Confirm that writeFileSync was called to write cache
      expect(mockedFs.writeFileSync).toHaveBeenCalled();
    });
  });

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
  describe.skip('Cache functionality', () => {
    it('should create cache directory if it does not exist', async () => {
      // NOTE: Cache directory is created at module load time, not during function execution
      // This test verifies the directory exists check happens (via existsSync)
      // The actual mkdirSync happens at module initialization, which is tested by module loading
      mockedFs.existsSync.mockReturnValue(false);

      // Ensure USE_CACHE_ONLY is not set
      const originalCacheOnly = process.env.USE_CACHE_ONLY;
      delete process.env.USE_CACHE_ONLY;

      try {
        // Mock both the initial range request and the limit fallback request
        mockedAxios.get.mockResolvedValueOnce({
          status: 200,
          data: { success: true, data: { items: [] } },
        });
        mockedAxios.get.mockResolvedValueOnce({
          status: 200,
          data: { success: true, data: { items: [] } },
        });

        await fetchHybridCandles(mockTokenAddress, mockStartTime, mockEndTime, 'solana');

        // The directory check happens (existsSync is called), but mkdirSync happens at module load
        // This test verifies the function works when directory doesn't exist
        expect(mockedFs.existsSync).toHaveBeenCalled();
      } finally {
        if (originalCacheOnly) {
          process.env.USE_CACHE_ONLY = originalCacheOnly;
        }
      }
    });

    it('should handle cache read errors gracefully', async () => {
      // Ensure USE_CACHE_ONLY is not set
      const originalCacheOnly = process.env.USE_CACHE_ONLY;
      delete process.env.USE_CACHE_ONLY;

      try {
        // existsSync returns true (cache dir exists)
        mockedFs.existsSync.mockReturnValue(true);

        // readdirSync returns array of strings (filenames), not Dirent objects
        // The implementation filters by filename pattern, so we need string filenames
        const cacheFilename = `solana_${mockTokenAddress}_${mockStartTime.toFormat('yyyyMMdd-HHmm')}_${mockEndTime.toFormat('yyyyMMdd-HHmm')}.csv`;
        mockedFs.readdirSync.mockReturnValue([cacheFilename] as any);
        // Mock statSync to return valid stats with recent mtime (not expired)
        mockedFs.statSync.mockReturnValue({
          mtime: new Date(), // Recent date, so cache is not expired
          size: 0,
          isFile: () => true,
          isDirectory: () => false,
        } as any);

        // readFileSync throws error to simulate cache read failure
        // loadCandlesFromCache catches this and returns null, so it falls through to API
        mockedFs.readFileSync.mockImplementation(() => {
          throw new Error('File read error');
        });

        // Mock both the initial range request and the limit fallback request
        mockedAxios.get.mockResolvedValueOnce({
          status: 200,
          data: { success: true, data: { items: [] } },
        });
        mockedAxios.get.mockResolvedValueOnce({
          status: 200,
          data: { success: true, data: { items: [] } },
        });

        const result = await fetchHybridCandles(
          mockTokenAddress,
          mockStartTime,
          mockEndTime,
          'solana'
        );

        // Cache read error is caught, falls through to API, which returns empty
        expect(result).toEqual([]);
      } finally {
        if (originalCacheOnly) {
          process.env.USE_CACHE_ONLY = originalCacheOnly;
        }
      }
    });

    it('should handle cache write errors gracefully', async () => {
      // Ensure USE_CACHE_ONLY is not set
      const originalCacheOnly = process.env.USE_CACHE_ONLY;
      delete process.env.USE_CACHE_ONLY;

      try {
        mockedFs.existsSync.mockReturnValue(false);
        // saveCandlesToCache catches write errors and logs them, but continues
        mockedFs.writeFileSync.mockImplementation(() => {
          throw new Error('File write error');
        });

        // Mock both range and limit API calls
        mockedAxios.get.mockResolvedValueOnce({
          status: 200,
          data: { success: true, data: { items: [] } },
        });
        mockedAxios.get.mockResolvedValueOnce({
          status: 200,
          data: { success: true, data: { items: [] } },
        });

        const result = await fetchHybridCandles(
          mockTokenAddress,
          mockStartTime,
          mockEndTime,
          'solana'
        );

        // Cache write error is caught and logged, function continues and returns API result
        expect(result).toEqual([]);
      } finally {
        if (originalCacheOnly) {
          process.env.USE_CACHE_ONLY = originalCacheOnly;
        }
      }
    });
  });

  // NOTE: API integration is part of fetchHybridCandles which has been moved to @quantbot/ohlcv
  describe.skip('API integration', () => {
    it('should construct correct API URLs for different chains', async () => {
      // Ensure USE_CACHE_ONLY is not set
      const originalCacheOnly = process.env.USE_CACHE_ONLY;
      delete process.env.USE_CACHE_ONLY;

      try {
        const chains = ['solana', 'ethereum', 'bsc', 'base'];

        for (const chain of chains) {
          // Mock both the initial request and the limit fallback request
          mockedAxios.get.mockResolvedValueOnce({
            status: 200,
            data: { success: true, data: { items: [] } },
          });
          mockedAxios.get.mockResolvedValueOnce({
            status: 200,
            data: { success: true, data: { items: [] } },
          });

          await fetchHybridCandles(mockTokenAddress, mockStartTime, mockEndTime, chain);

          // Verify that the API URL and params are set correctly for each chain
          // The address is passed as a query parameter, not in the URL path
          const lastCall = mockedAxios.get.mock.calls[mockedAxios.get.mock.calls.length - 1];
          expect(lastCall[0]).toContain('birdeye.so');
          expect(lastCall[1]?.params?.address).toBe(mockTokenAddress);
          expect(lastCall[1]?.headers?.['x-chain']).toBe(chain);
        }
      } finally {
        if (originalCacheOnly) {
          process.env.USE_CACHE_ONLY = originalCacheOnly;
        }
      }
    });

    it('should handle network timeouts', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('timeout'));

      await expect(
        fetchHybridCandles(mockTokenAddress, mockStartTime, mockEndTime, 'solana')
      ).rejects.toThrow('timeout');
    });

    it('should handle rate limiting', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('429 Too Many Requests'));

      await expect(
        fetchHybridCandles(mockTokenAddress, mockStartTime, mockEndTime, 'solana')
      ).rejects.toThrow('429 Too Many Requests');
    });
  });
});
