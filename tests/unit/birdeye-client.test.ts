/**
 * Birdeye Client Tests
 * ====================
 * Tests for Birdeye API client
 */

import { BirdeyeClient } from '../../src/api/birdeye-client';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('BirdeyeClient', () => {
  let client: BirdeyeClient;
  const mockApiKey = 'test-api-key';

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BIRDEYE_API_KEY = mockApiKey;
    client = new BirdeyeClient();
  });

  afterEach(() => {
    delete process.env.BIRDEYE_API_KEY;
  });

  describe('Initialization', () => {
    it('should initialize with API key', () => {
      expect(client).toBeDefined();
    });

    it('should handle missing API key', () => {
      delete process.env.BIRDEYE_API_KEY;
      expect(() => new BirdeyeClient()).not.toThrow();
    });
  });

  describe('Token Metadata', () => {
    it('should fetch token metadata', async () => {
      const mockResponse = {
        data: {
          data: {
            address: '0x123',
            symbol: 'TEST',
            name: 'Test Token',
            decimals: 18,
            price: 1.5,
          },
        },
      };

      mockedAxios.get.mockResolvedValue(mockResponse);

      const metadata = await client.getTokenMetadata('0x123', 'ethereum');

      expect(metadata).toBeDefined();
      expect(metadata?.symbol).toBe('TEST');
      expect(mockedAxios.get).toHaveBeenCalled();
    });

    it('should handle API errors', async () => {
      mockedAxios.get.mockRejectedValue(new Error('API error'));

      await expect(client.getTokenMetadata('0x123', 'ethereum')).rejects.toThrow();
    });
  });

  describe('OHLCV Data', () => {
    it('should fetch OHLCV data', async () => {
      const mockResponse = {
        data: {
          items: [
            { unixTime: 1000, o: 1.0, h: 1.1, l: 0.9, c: 1.05, v: 1000 },
          ],
        },
      };

      mockedAxios.get.mockResolvedValue(mockResponse);

      const ohlcv = await client.getOHLCV('0x123', 'ethereum', {
        startTime: new Date(1000),
        endTime: new Date(2000),
      });

      expect(ohlcv).toBeDefined();
      expect(Array.isArray(ohlcv)).toBe(true);
    });

    it('should handle empty OHLCV response', async () => {
      const mockResponse = {
        data: {
          items: [],
        },
      };

      mockedAxios.get.mockResolvedValue(mockResponse);

      const ohlcv = await client.getOHLCV('0x123', 'ethereum', {
        startTime: new Date(1000),
        endTime: new Date(2000),
      });

      expect(ohlcv).toEqual([]);
    });
  });

  describe('Rate Limiting', () => {
    it('should handle rate limit errors', async () => {
      const rateLimitError = {
        response: {
          status: 429,
          headers: { 'retry-after': '60' },
        },
      };

      mockedAxios.get.mockRejectedValue(rateLimitError);

      await expect(client.getTokenMetadata('0x123', 'ethereum')).rejects.toThrow();
    });
  });
});

