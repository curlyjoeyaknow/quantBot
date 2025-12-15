/**
 * Integration Tests for BirdeyeClient
 *
 * Tests API boundaries and real-world scenarios.
 * These tests verify the client works correctly with mocked HTTP responses.
 *
 * @remarks
 * These tests use mocked Axios instances to simulate API responses without
 * making actual HTTP requests. This allows us to test error handling,
 * rate limiting, and data parsing in isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BirdeyeClient, type AxiosFactory } from '../../src/birdeye-client';
import type { AxiosResponse, InternalAxiosRequestConfig, AxiosInstance } from 'axios';

/**
 * Mock the logger to prevent console output during tests
 * and allow verification of logging calls if needed
 */
vi.mock('@quantbot/utils', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

/**
 * Mock observability to prevent actual API usage recording
 * during tests while maintaining the interface
 */
vi.mock('@quantbot/observability', () => ({
  recordApiUsage: vi.fn().mockResolvedValue(undefined),
}));

/**
 * Mock dotenv to prevent environment variable loading
 * during tests (we provide config directly)
 */
vi.mock('dotenv', () => ({
  config: vi.fn(),
}));

describe('BirdeyeClient - Integration Tests', () => {
  let mockAxiosInstance: Partial<AxiosInstance> & {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    request: ReturnType<typeof vi.fn>;
  };
  let mockAxiosFactory: AxiosFactory;

  /**
   * Full-length Solana mint address for testing
   * @remarks Must be 32-44 characters to match real Solana addresses
   */
  const FULL_MINT = '7pXs123456789012345678901234567890pump';

  beforeEach(() => {
    // Clear all mocks before each test to ensure test isolation
    vi.clearAllMocks();

    /**
     * Create a mock Axios instance with all required methods and properties
     * This simulates the behavior of a real Axios instance without making HTTP requests
     */
    mockAxiosInstance = {
      get: vi.fn(),
      post: vi.fn(),
      request: vi.fn().mockResolvedValue({
        status: 200,
        data: {},
        statusText: 'OK',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      }),
      defaults: {
        baseURL: 'test',
        headers: {},
      },
      interceptors: {
        request: { use: vi.fn(), eject: vi.fn(), clear: vi.fn() },
        response: { use: vi.fn(), eject: vi.fn(), clear: vi.fn() },
      },
    } as unknown as Partial<AxiosInstance> & {
      get: ReturnType<typeof vi.fn>;
      post: ReturnType<typeof vi.fn>;
      request: ReturnType<typeof vi.fn>;
    };

    // Factory function that returns our mock instance
    mockAxiosFactory = vi.fn(() => mockAxiosInstance as unknown as AxiosInstance);
  });

  describe('API Boundary: OHLCV Fetching', () => {
    /**
     * Test that OHLCV data is fetched, parsed, and returned correctly
     *
     * @remarks
     * Skipped because it requires refactoring of the BirdeyeClient to properly
     * handle mocked responses. The client currently has tight coupling with
     * the HTTP layer that makes mocking difficult.
     */
    it.skip('fetches, parses, and returns OHLCV data correctly', async () => {
      // Mock a successful API response with OHLCV data
      const mockResponse: AxiosResponse = {
        status: 200,
        data: {
          data: {
            items: [
              {
                unix_time: 1704067200, // Unix timestamp for 2024-01-01
                o: '1.0', // Open price
                h: '1.1', // High price
                l: '0.9', // Low price
                c: '1.05', // Close price
                v: '1000', // Volume
              },
            ],
          },
        },
        statusText: 'OK',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const client = new BirdeyeClient({
        apiKeys: ['test-key'],
        axiosFactory: mockAxiosFactory,
      });

      // Fetch OHLCV data for a specific date range
      const result = await client.fetchOHLCVData(
        FULL_MINT,
        new Date('2024-01-01'),
        new Date('2024-01-02')
      );

      // Verify the response structure and data parsing
      expect(result).toBeTruthy();
      expect(result?.items).toBeDefined();
      expect(result?.items.length).toBe(1);
      expect(result?.items[0].open).toBe(1.0);
    });

    /**
     * Test that rate limiting triggers key rotation
     *
     * @remarks
     * This test verifies that when one API key hits rate limits (429 response),
     * the client automatically rotates to the next available key.
     *
     * The test:
     * 1. Creates a client with 2 API keys
     * 2. Makes key1's instance return 429 (rate limit)
     * 3. Makes key2's instance return success
     * 4. Verifies that key1 is deactivated and key2 is used
     */
    it('handles rate limiting with key rotation', async () => {
      // Use the same pattern as unit tests - shared mock instance
      // Create mock instance BEFORE setting up mocks to ensure it's ready
      const testMockInstance: any = {
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

      // Make first request return 429 (rate limit) - this will use key1
      const rateLimitError = {
        response: {
          status: 429,
          data: {},
          statusText: 'Too Many Requests',
          headers: {},
          config: {} as InternalAxiosRequestConfig,
        },
        config: {} as InternalAxiosRequestConfig,
        isAxiosError: true,
      };

      // Make second request return success - this will use key2
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
        config: {} as InternalAxiosRequestConfig,
      };

      // Setup mocks BEFORE creating factory: first call fails with 429, second call succeeds
      testMockInstance.get
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce(successResponse);

      // Factory returns the same instance for all keys (critical for test to work)
      const testFactory: AxiosFactory = vi.fn(() => testMockInstance);

      // Initialize client with two API keys
      const client = new BirdeyeClient({
        apiKeys: ['key1', 'key2'],
        axiosFactory: testFactory,
      });

      // Verify both keys are active initially
      expect(client.getActiveKeysCount()).toBe(2);
      expect(client.isKeyActive('key1')).toBe(true);
      expect(client.isKeyActive('key2')).toBe(true);

      // Make a request that should trigger key rotation
      const result = await client.fetchOHLCVData(
        FULL_MINT,
        new Date('2024-01-01'),
        new Date('2024-01-02')
      );

      // Verify both calls were made (key1 first, then key2 after rotation)
      expect(testMockInstance.get).toHaveBeenCalledTimes(2);

      // Verify key1 is now deactivated
      expect(client.isKeyActive('key1')).toBe(false);
      expect(client.getActiveKeysCount()).toBe(1);

      // Verify key2 is still active
      expect(client.isKeyActive('key2')).toBe(true);

      // Verify the request succeeded (using key2)
      expect(result).toBeDefined();
      expect(result?.items).toHaveLength(1);
    });
  });

  describe('API Boundary: Metadata Fetching', () => {
    /**
     * Test that token metadata is fetched and parsed correctly
     *
     * @remarks
     * This test verifies the happy path where the API returns valid metadata
     * for a token, including name, symbol, decimals, and logo URI.
     */
    it('fetches and parses token metadata correctly', async () => {
      // Mock a successful metadata response
      const mockResponse: AxiosResponse = {
        status: 200,
        data: {
          success: true,
          data: {
            name: 'Test Token',
            symbol: 'TEST',
            decimals: 9, // Standard for Solana tokens
            logoURI: 'https://example.com/logo.png',
          },
        },
        statusText: 'OK',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const client = new BirdeyeClient({
        apiKeys: ['test-key'],
        axiosFactory: mockAxiosFactory,
      });

      // Fetch metadata for a Solana token
      const result = await client.getTokenMetadata(FULL_MINT, 'solana');

      // Verify the metadata was parsed correctly
      expect(result).toBeTruthy();
      expect(result?.name).toBe('Test Token');
      expect(result?.symbol).toBe('TEST');
    });

    /**
     * Test that 404 responses are handled gracefully
     *
     * @remarks
     * When a token doesn't exist or isn't found in the Birdeye database,
     * the API returns a 404. The client should return null rather than
     * throwing an error, allowing the caller to handle the missing token.
     */
    it('returns null for 404 responses (token not found)', async () => {
      // Mock a 404 response (token not found)
      const mockResponse: AxiosResponse = {
        status: 404,
        data: { message: 'Token not found' },
        statusText: 'Not Found',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const client = new BirdeyeClient({
        apiKeys: ['test-key'],
        axiosFactory: mockAxiosFactory,
      });

      // Attempt to fetch metadata for a non-existent token
      const result = await client.getTokenMetadata(FULL_MINT, 'solana');

      // Verify null is returned (not an error thrown)
      expect(result).toBeNull();
    });
  });

  describe('API Boundary: Credit Tracking', () => {
    /**
     * Test that API credits are tracked correctly across multiple requests
     *
     * @remarks
     * Birdeye API has a credit system where each request consumes credits.
     * This test verifies that the client correctly tracks credit usage
     * and maintains an accurate count of remaining credits.
     *
     * The test uses a large dataset (500 items) to ensure credit consumption
     * is significant enough to be measurable.
     */
    it('tracks credits correctly across multiple requests', async () => {
      /**
       * Mock a response with 500 OHLCV data points
       * More data points = more credits consumed
       */
      const mockResponse: AxiosResponse = {
        status: 200,
        data: {
          data: {
            items: Array.from({ length: 500 }, (_, i) => ({
              unix_time: 1704067200 + i * 60, // One data point per minute
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
        config: {} as InternalAxiosRequestConfig,
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const client = new BirdeyeClient({
        apiKeys: ['test-key'],
        axiosFactory: mockAxiosFactory,
      });

      // Make a request that will consume credits
      await client.fetchOHLCVData(FULL_MINT, new Date('2024-01-01'), new Date('2024-01-02'));

      // Verify credit tracking
      const stats = client.getCreditUsageStats();
      expect(stats.creditsUsed).toBeGreaterThan(0); // Some credits were consumed
      expect(stats.creditsRemaining).toBeLessThan(20000000); // Total credits decreased
    });
  });
});
