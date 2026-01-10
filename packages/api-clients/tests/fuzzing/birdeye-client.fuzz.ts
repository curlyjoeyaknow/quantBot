/**
 * Fuzzing Tests for BirdeyeClient
 *
 * Tests API response parsing with malformed, malicious, and edge-case inputs.
 *
 * Critical: API clients must never crash on malformed responses.
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

describe('BirdeyeClient - Fuzzing Tests', () => {
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

  describe('OHLCV Response Parsing', () => {
    it('never crashes on malformed API responses', () => {
      fc.assert(
        fc.asyncProperty(
          fc.anything(), // Literally any response structure
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
              await client.fetchOHLCVData(
                '7pXs123456789012345678901234567890pump',
                new Date('2024-01-01'),
                new Date('2024-01-02')
              );
              return true; // Handled gracefully
            } catch (error) {
              // Must throw Error instance, not crash
              return error instanceof Error;
            }
          }
        ),
        { numRuns: 200 }
      );
    });

    it('handles all HTTP status codes gracefully', () => {
      fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 100, max: 599 }), // Any HTTP status
          async (status) => {
            const mockResponse: AxiosResponse = {
              status,
              data: {},
              statusText: 'Test',
              headers: {},
              config: {} as any,
            };

            mockAxiosInstance.get.mockResolvedValue(mockResponse);

            const client = new BirdeyeClient({
              apiKeys: ['test-key'],
              axiosFactory: mockAxiosFactory,
            });

            try {
              await client.fetchOHLCVData(
                '7pXs123456789012345678901234567890pump',
                new Date('2024-01-01'),
                new Date('2024-01-02')
              );
              return true;
            } catch (error) {
              return error instanceof Error;
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Metadata Response Parsing', () => {
    it('never crashes on malformed metadata responses', () => {
      fc.assert(
        fc.asyncProperty(fc.anything(), async (responseData) => {
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
            await client.getTokenMetadata('7pXs123456789012345678901234567890pump', 'solana');
            return true;
          } catch (error) {
            return error instanceof Error;
          }
        }),
        { numRuns: 200 }
      );
    });
  });

  describe('Mint Address Input Fuzzing', () => {
    it('handles any string input without crashing', () => {
      fc.assert(
        fc.asyncProperty(
          fc.string({ maxLength: 200 }), // Any string, any length
          async (input) => {
            const mockResponse: AxiosResponse = {
              status: 200,
              data: { data: { items: [] } },
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
              await client.fetchOHLCVData(
                input, // Any string as mint
                new Date('2024-01-01'),
                new Date('2024-01-02')
              );
              return true;
            } catch (error) {
              // Should handle gracefully, not crash
              return error instanceof Error;
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
