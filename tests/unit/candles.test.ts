import { fetchHybridCandles, Candle } from '../../src/simulation/candles';
import { DateTime } from 'luxon';

// Mock axios and fs before importing the module
jest.mock('axios', () => ({
  get: jest.fn()
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(() => false),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn()
}));

import axios from 'axios';
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Candle Data Handling', () => {
  const mockTokenAddress = 'So11111111111111111111111111111111111111112';
  const mockStartTime = DateTime.fromISO('2024-01-01T00:00:00Z');
  const mockEndTime = DateTime.fromISO('2024-01-02T00:00:00Z');

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset axios mock to default behavior
    mockedAxios.get.mockReset();
  });

  describe('fetchHybridCandles', () => {
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

      mockedAxios.get.mockResolvedValueOnce(mockResponse);

      const result = await fetchHybridCandles(mockTokenAddress, mockStartTime, mockEndTime, 'solana');

      expect(result).toBeDefined();
      expect(result.length).toBe(2);
      expect(result[0]).toEqual({
        timestamp: 1704067200,
        open: 1.0,
        high: 1.1,
        low: 0.9,
        close: 1.05,
        volume: 1000
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
                v: '1000'
              }
            ]
          }
        }
      };

      mockedAxios.get.mockResolvedValueOnce(mockResponse);

      const result = await fetchHybridCandles(mockTokenAddress, mockStartTime, mockEndTime, 'ethereum');

      expect(result).toBeDefined();
      expect(result.length).toBe(1);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('birdeye.so'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-chain': 'ethereum'
          })
        })
      );
    });

    it('should handle API errors gracefully', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('API Error'));

      await expect(fetchHybridCandles(mockTokenAddress, mockStartTime, mockEndTime, 'solana'))
        .rejects.toThrow('API Error');
    });

    it('should handle empty response data', async () => {
      const mockResponse = {
        data: {
          success: true,
          data: {
            items: []
          }
        }
      };

      mockedAxios.get.mockResolvedValueOnce(mockResponse);

      const result = await fetchHybridCandles(mockTokenAddress, mockStartTime, mockEndTime, 'solana');

      expect(result).toEqual([]);
    });

    it('should handle unsuccessful API response', async () => {
      const mockResponse = {
        data: {
          success: false,
          message: 'Token not found'
        }
      };

      mockedAxios.get.mockResolvedValueOnce(mockResponse);

      const result = await fetchHybridCandles(mockTokenAddress, mockStartTime, mockEndTime, 'solana');

      expect(result).toEqual([]);
    });

    it('should handle different chain types', async () => {
      const chains = ['solana', 'ethereum', 'bsc', 'base'];
      
      for (const chain of chains) {
        const mockResponse = {
          data: {
            success: true,
            data: { items: [] }
          }
        };

        mockedAxios.get.mockResolvedValueOnce(mockResponse);

        await fetchHybridCandles(mockTokenAddress, mockStartTime, mockEndTime, chain);

        expect(mockedAxios.get).toHaveBeenCalledWith(
          expect.stringContaining('birdeye.so'),
          expect.objectContaining({
            headers: expect.objectContaining({
              'x-chain': chain
            })
          })
        );
      }
    });

    it('should handle malformed candle data', async () => {
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
                v: '1000'
              }
            ]
          }
        }
      };

      mockedAxios.get.mockResolvedValueOnce(mockResponse);

      const result = await fetchHybridCandles(mockTokenAddress, mockStartTime, mockEndTime, 'solana');

      expect(result).toBeDefined();
      expect(result.length).toBe(1);
      expect(result[0].open).toBeNaN();
    });

    it('should handle missing candle properties', async () => {
      const mockResponse = {
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

      mockedAxios.get.mockResolvedValueOnce(mockResponse);

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

    it('should validate candle volume', () => {
      const candle: Candle = {
        timestamp: 1704067200,
        open: 1.0,
        high: 1.1,
        low: 0.9,
        close: 1.05,
        volume: 1000
      };

      expect(candle.volume).toBeGreaterThanOrEqual(0);
      expect(typeof candle.volume).toBe('number');
    });
  });
});