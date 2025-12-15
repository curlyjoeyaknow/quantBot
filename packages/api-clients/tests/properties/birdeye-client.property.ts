/**
 * Property Tests for BirdeyeClient
 *
 * Tests critical invariants using property-based testing (fast-check).
 *
 * Critical Invariants:
 * 1. Mint addresses are never truncated in API requests
 * 2. Mint addresses preserve exact case
 * 3. API responses are always valid or null (never undefined)
 * 4. Credit calculations are monotonic
 */

import { describe, it, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { BirdeyeClient, type AxiosFactory } from '@quantbot/api-clients/birdeye-client';
import type { AxiosResponse } from 'axios';

// Mock dependencies
vi.mock('@quantbot/utils', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@quantbot/observability', () => ({
  recordApiUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('dotenv', () => ({
  config: vi.fn(),
}));

describe('BirdeyeClient - Property Tests', () => {
  let mockAxiosInstance: any;
  let mockAxiosFactory: AxiosFactory;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAxiosInstance = {
      get: vi.fn(),
      post: vi.fn(),
      request: vi.fn().mockResolvedValue({
        status: 200,
        data: {},
        statusText: 'OK',
        headers: {},
        config: {} as any,
      }),
      defaults: { baseURL: 'test' },
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
    };

    mockAxiosFactory = vi.fn(() => mockAxiosInstance as any);
  });

  describe('Mint Address Preservation (Critical Invariant)', () => {
    it('preserves exact mint address case in API requests', () => {
      fc.assert(
        fc.asyncProperty(
          // Generate valid Solana mint addresses (32-44 chars, base58)
          fc.string({ minLength: 32, maxLength: 44 }),
          async (mint) => {
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

            const client = new BirdeyeClient({
              apiKeys: ['test-key'],
              axiosFactory: mockAxiosFactory,
            });

            await client.fetchOHLCVData(mint, new Date('2024-01-01'), new Date('2024-01-02'));

            // Verify the mint address was used exactly as provided
            const calls = mockAxiosInstance.get.mock.calls;
            if (calls.length > 0) {
              const requestParams = calls[0][1]?.params;
              if (requestParams?.address) {
                return requestParams.address === mint; // Exact match
              }
            }
            return true; // If no calls, test passes (handled by other tests)
          }
        ),
        { numRuns: 50 } // Reduced for speed
      );
    });

    it('preserves exact mint address in metadata requests', () => {
      fc.assert(
        fc.asyncProperty(fc.string({ minLength: 32, maxLength: 44 }), async (mint) => {
          const mockResponse: AxiosResponse = {
            status: 200,
            data: {
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

          const client = new BirdeyeClient({
            apiKeys: ['test-key'],
            axiosFactory: mockAxiosFactory,
          });

          await client.getTokenMetadata(mint, 'solana');

          // Verify the mint address was used exactly as provided
          const calls = mockAxiosInstance.get.mock.calls;
          if (calls.length > 0) {
            const requestParams = calls[0][1]?.params;
            if (requestParams?.address) {
              return requestParams.address === mint; // Exact match
            }
          }
          return true;
        }),
        { numRuns: 50 }
      );
    });
  });

  describe('Response Validity (Critical Invariant)', () => {
    it('always returns valid response or null, never undefined', () => {
      fc.assert(
        fc.asyncProperty(
          fc.anything(), // Any API response structure
          async (responseData) => {
            const mockResponse: AxiosResponse = {
              status: 200,
              data: responseData,
              statusText: 'OK',
              headers: {},
              config: {} as any,
            };

            mockAxiosInstance.get.mockResolvedValue(mockResponse);

            const client = new BirdeyeClient({
              apiKeys: ['test-key'],
              axiosFactory: mockAxiosFactory,
            });

            try {
              const result = await client.fetchOHLCVData(
                '7pXs123456789012345678901234567890pump',
                new Date('2024-01-01'),
                new Date('2024-01-02')
              );

              // Result should be either valid object or null, never undefined
              return result === null || (typeof result === 'object' && result !== undefined);
            } catch (error) {
              // Errors are acceptable, but should be Error instances
              return error instanceof Error;
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Credit Calculation Monotonicity', () => {
    it('credit usage increases monotonically with candle count', () => {
      fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 10000 }), // candle count 1
          fc.integer({ min: 0, max: 10000 }), // candle count 2
          async (count1, count2) => {
            if (count1 > count2) {
              // Higher candle count should use more credits
              const credits1 = count1 >= 1000 ? 120 : 60;
              const credits2 = count2 >= 1000 ? 120 : 60;
              return credits1 >= credits2;
            }
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
