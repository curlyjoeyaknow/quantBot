/**
 * Tests for helius-client.ts
 *
 * Tests cover:
 * - Client initialization
 * - Transaction fetching for address
 * - Transaction fetching by signatures
 * - Error handling
 * - API usage recording
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  HeliusRestClient,
  type AddressTransactionsOptions,
} from '@quantbot/api-clients/helius-client';

// Mock utils
vi.mock('@quantbot/infra/utils', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public apiName: string,
      public apiStatusCode?: number
    ) {
      super(message);
    }
  },
  RateLimitError: class RateLimitError extends Error {
    constructor(
      message: string,
      public retryAfter: number
    ) {
      super(message);
    }
  },
  TimeoutError: class TimeoutError extends Error {
    constructor(
      message: string,
      public timeout: number
    ) {
      super(message);
    }
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
  isRetryableError: vi.fn(() => false),
  retryWithBackoff: vi.fn(async (fn, maxRetries, initialDelay, context) => {
    // Just call the function once without actual retry logic
    return await fn();
  }),
}));

// Mock observability
vi.mock('@quantbot/infra/observability', () => ({
  recordApiUsage: vi.fn().mockResolvedValue(undefined),
}));

describe('HeliusRestClient', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let mockAxiosInstance: any;

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
        timeout: 30000,
        headers: {
          common: {},
        },
      },
    };

    // Set up default API key and URL for tests
    process.env.HELIUS_API_KEY = 'test-helius-key';
    process.env.HELIUS_REST_URL = 'https://api.helius.xyz';
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('Initialization', () => {
    it('should create client with injected axios instance', () => {
      const client = new HeliusRestClient({
        apiKey: 'test-key',
        axiosInstance: mockAxiosInstance,
      });

      expect(client).toBeDefined();
      expect(client).toBeInstanceOf(HeliusRestClient);
    });

    it('should use custom API key when provided', () => {
      const client = new HeliusRestClient({
        apiKey: 'custom-api-key',
        axiosInstance: mockAxiosInstance,
      });

      expect(client).toBeDefined();
    });

    it('should use custom base URL when provided', () => {
      const client = new HeliusRestClient({
        apiKey: 'test-key',
        baseURL: 'https://custom.helius.url',
        axiosInstance: mockAxiosInstance,
      });

      expect(client).toBeDefined();
    });
  });

  describe('getTransactionsForAddress', () => {
    let client: HeliusRestClient;
    const address = 'So11111111111111111111111111111111111111112';

    beforeEach(() => {
      client = new HeliusRestClient({
        apiKey: 'test-helius-key',
        axiosInstance: mockAxiosInstance,
      });
    });

    it('should fetch transactions for address successfully', async () => {
      const mockTransactions = [
        { signature: 'sig1', slot: 12345 },
        { signature: 'sig2', slot: 12346 },
      ];

      const mockResponse = {
        data: mockTransactions,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockAxiosInstance.request.mockResolvedValue(mockResponse);

      const result = await client.getTransactionsForAddress(address);

      expect(result).toEqual(mockTransactions);
      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: `/v0/addresses/${address}/transactions`,
          params: {
            'api-key': 'test-helius-key',
            limit: 100,
          },
        })
      );
    });

    it('should use custom limit when provided', async () => {
      const mockResponse = {
        data: [],
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockAxiosInstance.request.mockResolvedValue(mockResponse);

      const options: AddressTransactionsOptions = {
        limit: 50,
      };

      await client.getTransactionsForAddress(address, options);

      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: `/v0/addresses/${address}/transactions`,
          params: expect.objectContaining({
            limit: 50,
          }),
        })
      );
    });

    it('should include before parameter when provided', async () => {
      const mockResponse = {
        data: [],
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockAxiosInstance.request.mockResolvedValue(mockResponse);

      const options: AddressTransactionsOptions = {
        before: 'signature123',
      };

      await client.getTransactionsForAddress(address, options);

      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: `/v0/addresses/${address}/transactions`,
          params: expect.objectContaining({
            before: 'signature123',
          }),
        })
      );
    });

    it('should return empty array if response is not an array', async () => {
      const mockResponse = {
        data: { error: 'Invalid response' },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockAxiosInstance.request.mockResolvedValue(mockResponse);

      const result = await client.getTransactionsForAddress(address);

      expect(result).toEqual([]);
    });

    it('should throw error if API key is missing', async () => {
      const clientWithoutKey = new HeliusRestClient({
        apiKey: '',
        axiosInstance: mockAxiosInstance,
      });

      await expect(clientWithoutKey.getTransactionsForAddress(address)).rejects.toThrow(
        'HELIUS_API_KEY missing'
      );
    });

    it('should handle errors and rethrow', async () => {
      const error = new Error('Network error');
      mockAxiosInstance.request.mockRejectedValue(error);

      await expect(client.getTransactionsForAddress(address)).rejects.toThrow('Network error');
    });
  });

  describe('getTransactions', () => {
    let client: HeliusRestClient;
    const signatures = ['sig1', 'sig2', 'sig3'];

    beforeEach(() => {
      client = new HeliusRestClient({
        apiKey: 'test-helius-key',
        axiosInstance: mockAxiosInstance,
      });
    });

    it('should fetch transactions by signatures successfully', async () => {
      const mockTransactions = [
        { signature: 'sig1', slot: 12345 },
        { signature: 'sig2', slot: 12346 },
        { signature: 'sig3', slot: 12347 },
      ];

      const mockResponse = {
        data: mockTransactions,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockAxiosInstance.request.mockResolvedValue(mockResponse);

      const result = await client.getTransactions(signatures);

      expect(result).toEqual(mockTransactions);
      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: `/v0/transactions/?api-key=test-helius-key`,
          data: signatures,
        })
      );
    });

    it('should return empty array for empty signatures array', async () => {
      const result = await client.getTransactions([]);

      expect(result).toEqual([]);
      expect(mockAxiosInstance.request).not.toHaveBeenCalled();
    });

    it('should return empty array if response is not an array', async () => {
      const mockResponse = {
        data: { error: 'Invalid response' },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockAxiosInstance.request.mockResolvedValue(mockResponse);

      const result = await client.getTransactions(signatures);

      expect(result).toEqual([]);
    });

    it('should throw error if API key is missing', async () => {
      const clientWithoutKey = new HeliusRestClient({
        apiKey: '',
        axiosInstance: mockAxiosInstance,
      });

      await expect(clientWithoutKey.getTransactions(signatures)).rejects.toThrow(
        'HELIUS_API_KEY missing'
      );
    });

    it('should handle errors and rethrow', async () => {
      const error = new Error('Network error');
      mockAxiosInstance.request.mockRejectedValue(error);

      await expect(client.getTransactions(signatures)).rejects.toThrow('Network error');
    });
  });

  describe('API Usage Recording', () => {
    it('should record API usage for getTransactionsForAddress', async () => {
      const { recordApiUsage } = await import('@quantbot/observability');

      const client = new HeliusRestClient({
        apiKey: 'test-helius-key',
        axiosInstance: mockAxiosInstance,
      });
      const address = 'So11111111111111111111111111111111111111112';

      const mockResponse = {
        data: [{ signature: 'sig1' }],
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockAxiosInstance.request.mockResolvedValue(mockResponse);

      await client.getTransactionsForAddress(address);

      expect(recordApiUsage).toHaveBeenCalledWith(
        'helius',
        100,
        expect.objectContaining({
          endpoint: '/v0/addresses/:address/transactions',
          transactionCount: 1,
        })
      );
    });

    it('should record API usage for getTransactions', async () => {
      const { recordApiUsage } = await import('@quantbot/observability');

      const client = new HeliusRestClient({
        apiKey: 'test-helius-key',
        axiosInstance: mockAxiosInstance,
      });
      const signatures = ['sig1', 'sig2'];

      const mockResponse = {
        data: [{ signature: 'sig1' }, { signature: 'sig2' }],
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockAxiosInstance.request.mockResolvedValue(mockResponse);

      await client.getTransactions(signatures);

      expect(recordApiUsage).toHaveBeenCalledWith(
        'helius',
        100,
        expect.objectContaining({
          endpoint: '/v0/transactions',
          signatureCount: 2,
          transactionCount: 2,
        })
      );
    });
  });
});
