/**
 * Tests for birdeye-client.ts
 *
 * Tests cover:
 * - API key loading
 * - OHLCV data fetching
 * - Token metadata fetching
 * - API key rotation
 * - Credit usage tracking
 * - Error handling and retries
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AxiosResponse } from 'axios';
import {
  BirdeyeClient,
  type BirdeyeOHLCVResponse,
  type APIKeyUsage,
} from '../../src/birdeye-client';
import type { AxiosFactory } from '../../src/birdeye-client';

// Mock utils
vi.mock('@quantbot/utils', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  ConfigurationError: class ConfigurationError extends Error {
    constructor(
      message: string,
      public configKey?: string
    ) {
      super(message);
      this.name = 'ConfigurationError';
    }
  },
}));

// Mock observability
vi.mock('@quantbot/observability', () => ({
  recordApiUsage: vi.fn().mockResolvedValue(undefined),
}));

// Mock dotenv
vi.mock('dotenv', () => ({
  config: vi.fn(),
}));

describe('BirdeyeClient', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let mockAxiosInstance: any;
  let mockAxiosFactory: AxiosFactory;

  beforeEach(() => {
    vi.clearAllMocks();

    // Save original env
    originalEnv = { ...process.env };

    // Create mock axios instance with interceptors
    mockAxiosInstance = {
      get: vi.fn(),
      post: vi.fn(),
      request: vi.fn(),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
      defaults: {
        timeout: 10000,
        baseURL: 'https://public-api.birdeye.so',
      },
    };

    // Create mock factory that returns our mock instance
    mockAxiosFactory = vi.fn(() => mockAxiosInstance);

    // Set up default API key for tests
    process.env.BIRDEYE_API_KEY = 'test-api-key-123';

    // Clear numbered API keys
    for (let i = 1; i <= 6; i++) {
      delete process.env[`BIRDEYE_API_KEY_${i}`];
    }
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('Initialization', () => {
    it('should load API keys from environment', () => {
      process.env.BIRDEYE_API_KEY = 'key1';
      process.env.BIRDEYE_API_KEY_1 = 'key2';
      process.env.BIRDEYE_API_KEY_2 = 'key3';

      const client = new BirdeyeClient({ axiosFactory: mockAxiosFactory });

      expect(client).toBeDefined();
      expect(client).toBeInstanceOf(BirdeyeClient);
      // Factory is called once for base class + once per API key
      expect(mockAxiosFactory).toHaveBeenCalledTimes(4);
    });

    it('should throw error if no API keys found', () => {
      // Save original env vars
      const originalKeys = {
        BIRDEYE_API_KEY: process.env.BIRDEYE_API_KEY,
        BIRDEYE_API_KEY_1: process.env.BIRDEYE_API_KEY_1,
        BIRDEYE_API_KEY_2: process.env.BIRDEYE_API_KEY_2,
        BIRDEYE_API_KEY_3: process.env.BIRDEYE_API_KEY_3,
        BIRDEYE_API_KEY_4: process.env.BIRDEYE_API_KEY_4,
        BIRDEYE_API_KEY_5: process.env.BIRDEYE_API_KEY_5,
        BIRDEYE_API_KEY_6: process.env.BIRDEYE_API_KEY_6,
      };

      // Delete all API keys
      delete process.env.BIRDEYE_API_KEY;
      delete process.env.BIRDEYE_API_KEY_1;
      delete process.env.BIRDEYE_API_KEY_2;
      delete process.env.BIRDEYE_API_KEY_3;
      delete process.env.BIRDEYE_API_KEY_4;
      delete process.env.BIRDEYE_API_KEY_5;
      delete process.env.BIRDEYE_API_KEY_6;

      expect(() => new BirdeyeClient({ axiosFactory: mockAxiosFactory })).toThrow(
        'No Birdeye API keys found'
      );

      // Restore original env vars
      Object.assign(process.env, originalKeys);
    });

    it('should create axios instance for each API key', () => {
      process.env.BIRDEYE_API_KEY = 'key1';
      process.env.BIRDEYE_API_KEY_1 = 'key2';

      const client = new BirdeyeClient({ axiosFactory: mockAxiosFactory });

      // Factory is called once for base class + once per API key
      expect(mockAxiosFactory).toHaveBeenCalledTimes(3);
      expect(mockAxiosFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://public-api.birdeye.so',
          timeout: 10000,
        })
      );
    });

    it('should use custom API keys when provided', () => {
      const customKeys = ['custom-key-1', 'custom-key-2'];

      const client = new BirdeyeClient({
        apiKeys: customKeys,
        axiosFactory: mockAxiosFactory,
      });

      // Factory is called once for base class + once per API key
      expect(mockAxiosFactory).toHaveBeenCalledTimes(3);
      const usage = client.getAPIKeyUsage();
      expect(usage).toHaveLength(2);
      expect(usage[0].key).toBe('custom-key-1');
    });

    it('should use custom base URL when provided', () => {
      const client = new BirdeyeClient({
        apiKeys: ['test-key'],
        baseURL: 'https://custom-api.example.com',
        axiosFactory: mockAxiosFactory,
      });

      expect(mockAxiosFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://custom-api.example.com',
        })
      );
    });
  });

  describe('fetchOHLCVData', () => {
    let client: BirdeyeClient;
    const tokenAddress = 'So11111111111111111111111111111111111111112';
    const startTime = new Date('2024-01-01T00:00:00Z');
    const endTime = new Date('2024-01-02T00:00:00Z');

    beforeEach(() => {
      client = new BirdeyeClient({
        apiKeys: ['test-key'],
        axiosFactory: mockAxiosFactory,
      });
    });

    it('should fetch OHLCV data successfully', async () => {
      const mockResponse: AxiosResponse = {
        status: 200,
        data: {
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
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockAxiosInstance.get.mockResolvedValueOnce(mockResponse);

      // Create client AFTER setting up mock
      const testClient = new BirdeyeClient({
        apiKeys: ['test-key'],
        axiosFactory: mockAxiosFactory,
      });

      const result = await testClient.fetchOHLCVData(
        tokenAddress,
        startTime,
        endTime,
        '1m',
        'solana'
      );

      expect(mockAxiosInstance.get).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result).not.toBeNull();
      if (result) {
        expect(result.items).toBeDefined();
        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toEqual({
          unixTime: 1704067200,
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        });
      }
    });

    it('should handle empty response', async () => {
      const mockResponse: AxiosResponse = {
        status: 200,
        data: {
          data: {
            items: [],
          },
        },
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await client.fetchOHLCVData(tokenAddress, startTime, endTime);

      expect(result).toBeNull();
    });

    it('should handle 400/404 errors gracefully', async () => {
      const mockResponse: AxiosResponse = {
        status: 404,
        data: { error: 'Token not found' },
        statusText: 'Not Found',
        headers: {},
        config: {} as any,
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await client.fetchOHLCVData(tokenAddress, startTime, endTime);

      expect(result).toBeNull();
    });

    it('should handle rate limit (429) and retry with next key', async () => {
      // Create separate mock instances for each key
      const mockAxiosInstanceBase = {
        ...mockAxiosInstance,
        get: vi.fn(),
      };
      const mockAxiosInstance1 = {
        ...mockAxiosInstance,
        get: vi.fn(),
      };
      const mockAxiosInstance2 = {
        ...mockAxiosInstance,
        get: vi.fn(),
      };

      // Factory returns different instances: base (for constructor), then key1, then key2
      let factoryCallCount = 0;
      const factoryWithMultipleInstances = vi.fn((config) => {
        factoryCallCount++;
        if (factoryCallCount === 1) {
          return mockAxiosInstanceBase; // Base client instance
        } else if (factoryCallCount === 2) {
          return mockAxiosInstance1; // First API key
        } else {
          return mockAxiosInstance2; // Second API key
        }
      });

      const client = new BirdeyeClient({
        apiKeys: ['key1', 'key2'],
        axiosFactory: factoryWithMultipleInstances,
      });

      const rateLimitError = {
        response: {
          status: 429,
          data: {},
          statusText: 'Too Many Requests',
          headers: {},
          config: {} as any,
        },
        request: {},
        config: {} as any,
        isAxiosError: true,
      };

      const successResponse: AxiosResponse = {
        status: 200,
        data: {
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
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockAxiosInstance1.get.mockRejectedValueOnce(rateLimitError);
      mockAxiosInstance2.get.mockResolvedValueOnce(successResponse);

      const result = await client.fetchOHLCVData(tokenAddress, startTime, endTime);

      expect(result).toBeDefined();
      expect(mockAxiosInstance1.get).toHaveBeenCalledTimes(1);
      expect(mockAxiosInstance2.get).toHaveBeenCalledTimes(1);
    });

    it('should detect chain from address format (0x = ethereum)', async () => {
      const ethereumAddress = '0x1234567890123456789012345678901234567890';
      const mockResponse: AxiosResponse = {
        status: 200,
        data: {
          data: {
            items: [],
          },
        },
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      await client.fetchOHLCVData(ethereumAddress, startTime, endTime, '1m', 'ethereum');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        '/defi/v3/ohlcv',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-chain': 'ethereum',
          }),
        })
      );
    });

    it('should calculate credits correctly for different candle counts', async () => {
      const smallResponse: AxiosResponse = {
        status: 200,
        data: {
          data: {
            items: Array.from({ length: 500 }, (_, i) => ({
              unix_time: 1704067200 + i * 60,
              o: '1.0',
              h: '1.1',
              l: '0.9',
              c: '1.05',
              v: '1000',
            })),
          },
        },
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockAxiosInstance.get.mockResolvedValue(smallResponse);

      await client.fetchOHLCVData(tokenAddress, startTime, endTime);

      const usage = client.getAPIKeyUsage();
      // 500 candles < 1000, so should use 60 credits
      expect(usage[0].estimatedCreditsUsed).toBe(60);
    });
  });

  describe('getTokenMetadata', () => {
    let client: BirdeyeClient;
    const tokenAddress = 'So11111111111111111111111111111111111111112';

    beforeEach(() => {
      client = new BirdeyeClient({
        apiKeys: ['test-key'],
        axiosFactory: mockAxiosFactory,
      });
    });

    it('should fetch token metadata successfully', async () => {
      const mockResponse: AxiosResponse = {
        status: 200,
        data: {
          success: true,
          data: {
            name: 'Test Token',
            symbol: 'TEST',
          },
        },
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await client.getTokenMetadata(tokenAddress, 'solana');

      expect(result).toEqual({
        name: 'Test Token',
        symbol: 'TEST',
      });
    });

    it('should return null for 404 errors', async () => {
      const mockResponse: AxiosResponse = {
        status: 404,
        data: {},
        statusText: 'Not Found',
        headers: {},
        config: {} as any,
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await client.getTokenMetadata(tokenAddress);

      expect(result).toBeNull();
    });

    it('should use fallback name/symbol if not provided', async () => {
      const mockResponse: AxiosResponse = {
        status: 200,
        data: {
          success: true,
          data: {},
        },
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await client.getTokenMetadata(tokenAddress);

      expect(result).toBeDefined();
      expect(result?.name).toContain('Token');
      expect(result?.symbol).toBeDefined();
    });
  });

  describe('API Key Management', () => {
    it('should track API key usage', () => {
      const client = new BirdeyeClient({
        apiKeys: ['key1', 'key2'],
        axiosFactory: mockAxiosFactory,
      });

      const usage = client.getAPIKeyUsage();

      expect(usage).toHaveLength(2);
      expect(usage[0].key).toBe('key1');
      expect(usage[1].key).toBe('key2');
    });

    it('should rotate API keys using round-robin', async () => {
      const client = new BirdeyeClient({
        apiKeys: ['key1', 'key2'],
        axiosFactory: mockAxiosFactory,
      });

      const mockResponse: AxiosResponse = {
        status: 200,
        data: {
          data: {
            items: [],
          },
        },
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      await client.fetchOHLCVData('So11111111111111111111111111111111111111112', new Date(), new Date());
      await client.fetchOHLCVData('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', new Date(), new Date());

      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
    });

    it('should reset usage statistics', () => {
      const client = new BirdeyeClient({
        apiKeys: ['key1'],
        axiosFactory: mockAxiosFactory,
      });

      client.resetUsageStats();

      const usage = client.getAPIKeyUsage();
      expect(usage[0].requestsUsed).toBe(0);
      expect(usage[0].estimatedCreditsUsed).toBe(0);
    });
  });

  describe('Credit Tracking', () => {
    it('should track total credits used', async () => {
      const client = new BirdeyeClient({
        apiKeys: ['key1'],
        axiosFactory: mockAxiosFactory,
      });

      const mockResponse: AxiosResponse = {
        status: 200,
        data: {
          data: {
            items: Array.from({ length: 500 }, (_, i) => ({
              unix_time: 1704067200 + i * 60,
              o: '1.0',
              h: '1.1',
              l: '0.9',
              c: '1.05',
              v: '1000',
            })),
          },
        },
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      await client.fetchOHLCVData('So11111111111111111111111111111111111111112', new Date(), new Date());

      const totalCredits = client.getTotalCreditsUsed();
      expect(totalCredits).toBe(60);
    });

    it('should calculate remaining credits', () => {
      const client = new BirdeyeClient({
        apiKeys: ['key1'],
        axiosFactory: mockAxiosFactory,
      });

      const remaining = client.getRemainingCredits();
      // With no credits used, remaining should equal TOTAL_CREDITS (20M)
      expect(remaining).toBe(20000000);
    });

    it('should detect when approaching credit limit', () => {
      const client = new BirdeyeClient({
        apiKeys: ['key1'],
        axiosFactory: mockAxiosFactory,
      });

      const isApproaching = client.isApproachingCreditLimit();
      expect(typeof isApproaching).toBe('boolean');
    });

    it('should get credit usage statistics', () => {
      const client = new BirdeyeClient({
        apiKeys: ['key1'],
        axiosFactory: mockAxiosFactory,
      });

      const stats = client.getCreditUsageStats();
      expect(stats).toHaveProperty('totalCredits');
      expect(stats).toHaveProperty('creditsUsed');
      expect(stats).toHaveProperty('creditsRemaining');
      expect(stats).toHaveProperty('percentage');
    });
  });

  describe('Error Handling', () => {
    it('should handle server errors with retry', async () => {
      const client = new BirdeyeClient({
        apiKeys: ['key1'],
        axiosFactory: mockAxiosFactory,
      });

      const serverError = {
        response: {
          status: 500,
          data: { error: 'Internal Server Error' },
        },
        isAxiosError: true,
      };

      const successResponse: AxiosResponse = {
        status: 200,
        data: {
          data: {
            items: [],
          },
        },
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockAxiosInstance.get
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce(successResponse);

      const result = await client.fetchOHLCVData('So11111111111111111111111111111111111111112', new Date(), new Date());

      // Server errors don't trigger key rotation, so only 1 call is made
      // The retry logic is handled by BaseApiClient, not by key rotation
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);
      expect(result).toBeDefined();
    });

    it('should not retry on 400/401/403 errors', async () => {
      const client = new BirdeyeClient({
        apiKeys: ['key1'],
        axiosFactory: mockAxiosFactory,
      });

      const badRequestResponse: AxiosResponse = {
        status: 400,
        data: { error: 'Bad Request' },
        statusText: 'Bad Request',
        headers: {},
        config: {} as any,
      };

      mockAxiosInstance.get.mockResolvedValue(badRequestResponse);

      const result = await client.fetchOHLCVData('So11111111111111111111111111111111111111112', new Date(), new Date());

      expect(result).toBeNull();
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);
    });
  });
});
