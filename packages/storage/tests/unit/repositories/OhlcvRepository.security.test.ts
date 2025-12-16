/**
 * Security Tests for OhlcvRepository
 *
 * Tests for:
 * - SQL injection prevention (parameterized queries)
 * - Input validation
 * - Mint address handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { OhlcvRepository } from '../../../src/clickhouse/repositories/OhlcvRepository';
import type { Chain, TokenAddress } from '@quantbot/core';

// Mock ClickHouse client
const mockClickHouseClient = {
  insert: vi.fn(),
  query: vi.fn().mockResolvedValue({
    json: async () => [],
  }),
  exec: vi.fn(),
};

vi.mock('../../src/clickhouse-client', () => ({
  getClickHouseClient: vi.fn(() => mockClickHouseClient),
}));

vi.mock('@quantbot/utils', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('OhlcvRepository Security', () => {
  let repository: OhlcvRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new OhlcvRepository();
    mockClickHouseClient.insert.mockResolvedValue(undefined);
    mockClickHouseClient.query.mockResolvedValue({
      json: () => Promise.resolve([]),
    });
  });

  describe('SQL Injection Prevention', () => {
    it('should use parameterized queries for token address', async () => {
      const maliciousInput = "'; DROP TABLE ohlcv_candles; --";
      const tokenAddress = 'So11111111111111111111111111111111111111112' as TokenAddress;
      const chain: Chain = 'solana';
      const range = {
        from: DateTime.now().minus({ days: 1 }),
        to: DateTime.now(),
      };

      await repository.getCandles(tokenAddress, chain, '1m', range);

      expect(mockClickHouseClient.query).toHaveBeenCalled();

      // Get the first argument passed to query
      const queryCall = mockClickHouseClient.query.mock.calls[0]?.[0];

      // Verify the call was made with the expected structure
      expect(queryCall).toBeDefined();
      expect(queryCall).toHaveProperty('query_params');
      expect(queryCall.query_params).toBeDefined();
      expect(queryCall.query_params.tokenAddress).toBe(tokenAddress);

      // Query should contain parameter placeholders, not string interpolation
      expect(queryCall.query).toContain('{tokenAddress:String}');
      expect(queryCall.query).not.toContain(maliciousInput);
    });

    it('should use parameterized queries for chain', async () => {
      const tokenAddress = 'So11111111111111111111111111111111111111112' as TokenAddress;
      const maliciousChain = "'; DROP TABLE ohlcv_candles; --" as any;
      const range = {
        from: DateTime.now().minus({ days: 1 }),
        to: DateTime.now(),
      };

      // TypeScript should prevent this, but test runtime behavior
      try {
        await repository.getCandles(tokenAddress, maliciousChain, '1m', range);
      } catch (error) {
        // Expected to fail validation
      }

      if (mockClickHouseClient.query.mock.calls.length > 0) {
        const queryCall = mockClickHouseClient.query.mock.calls[0][0];
        // Should use parameterized query
        expect(queryCall.query_params).toBeDefined();
        expect(queryCall.query).toContain('{chain:String}');
      }
    });

    it('should use parameterized queries for interval', async () => {
      const tokenAddress = 'So11111111111111111111111111111111111111112' as TokenAddress;
      const chain: Chain = 'solana';
      const maliciousInterval = "'; DROP TABLE ohlcv_candles; --";
      const range = {
        from: DateTime.now().minus({ days: 1 }),
        to: DateTime.now(),
      };

      await repository.getCandles(tokenAddress, chain, maliciousInterval, range);

      expect(mockClickHouseClient.query).toHaveBeenCalled();
      const queryCall = mockClickHouseClient.query.mock.calls[0][0];

      // Should use parameterized query
      expect(queryCall.query_params).toBeDefined();
      expect(queryCall.query_params.interval).toBe(maliciousInterval);
      expect(queryCall.query).toContain('{interval:String}');
    });

    it('should use parameterized queries for timestamps', async () => {
      const tokenAddress = 'So11111111111111111111111111111111111111112' as TokenAddress;
      const chain: Chain = 'solana';
      const range = {
        from: DateTime.now().minus({ days: 1 }),
        to: DateTime.now(),
      };

      await repository.getCandles(tokenAddress, chain, '1m', range);

      expect(mockClickHouseClient.query).toHaveBeenCalled();
      const queryCall = mockClickHouseClient.query.mock.calls[0][0];

      // Should use parameterized query for timestamps
      expect(queryCall.query_params).toBeDefined();
      expect(queryCall.query_params.startUnix).toBeDefined();
      expect(queryCall.query_params.endUnix).toBeDefined();
      expect(queryCall.query).toContain('{startUnix:UInt32}');
      expect(queryCall.query).toContain('{endUnix:UInt32}');
    });

    it('should use parameterized queries in hasCandles', async () => {
      const tokenAddress = 'So11111111111111111111111111111111111111112' as TokenAddress;
      const chain: Chain = 'solana';
      const range = {
        from: DateTime.now().minus({ days: 1 }),
        to: DateTime.now(),
      };

      await repository.hasCandles(tokenAddress, chain, range);

      expect(mockClickHouseClient.query).toHaveBeenCalled();
      const queryCall = mockClickHouseClient.query.mock.calls[0][0];

      // Should use parameterized query
      expect(queryCall.query_params).toBeDefined();
      expect(queryCall.query_params.tokenAddress).toBe(tokenAddress);
      expect(queryCall.query_params.chain).toBe(chain);
      expect(queryCall.query).toContain('{tokenAddress:String}');
      expect(queryCall.query).toContain('{chain:String}');
    });
  });

  describe('Input Validation', () => {
    it('should handle invalid token addresses gracefully', async () => {
      const invalidAddress = 'invalid' as TokenAddress;
      const chain: Chain = 'solana';
      const range = {
        from: DateTime.now().minus({ days: 1 }),
        to: DateTime.now(),
      };

      // Should not throw, but may return empty results
      await expect(
        repository.getCandles(invalidAddress, chain, '1m', range)
      ).resolves.toBeDefined();
    });

    it('should handle invalid date ranges', async () => {
      const tokenAddress = 'So11111111111111111111111111111111111111112' as TokenAddress;
      const chain: Chain = 'solana';
      const invalidRange = {
        from: DateTime.now(),
        to: DateTime.now().minus({ days: 1 }), // End before start
      };

      // Should handle gracefully
      await expect(
        repository.getCandles(tokenAddress, chain, '1m', invalidRange)
      ).resolves.toBeDefined();
    });
  });

  describe('Mint Address Preservation', () => {
    it('should preserve full mint address in queries', async () => {
      const fullMint = '7pXs123456789012345678901234567890pump' as TokenAddress;
      const chain: Chain = 'solana';
      const range = {
        from: DateTime.now().minus({ days: 1 }),
        to: DateTime.now(),
      };

      await repository.getCandles(fullMint, chain, '1m', range);

      expect(mockClickHouseClient.query).toHaveBeenCalled();
      const queryCall = mockClickHouseClient.query.mock.calls[0][0];

      // Should preserve full address in parameter
      expect(queryCall.query_params.tokenAddress).toBe(fullMint);
      expect(queryCall.query_params.tokenAddress.length).toBeGreaterThanOrEqual(32);
    });

    it('should preserve case of mint address', async () => {
      // Use type assertion for testing since createTokenAddress may not be available in test environment
      const upperCaseMint = '7PXS123456789012345678901234567890PUMP' as TokenAddress;
      const lowerCaseMint = '7pxs123456789012345678901234567890pump' as TokenAddress;
      const chain: Chain = 'solana';
      const range = {
        from: DateTime.now().minus({ days: 1 }),
        to: DateTime.now(),
      };

      await repository.getCandles(upperCaseMint, chain, '1m', range);
      const queryCall1 = mockClickHouseClient.query.mock.calls[0][0];
      expect(queryCall1.query_params.tokenAddress).toBe(upperCaseMint);

      await repository.getCandles(lowerCaseMint, chain, '1m', range);
      const queryCall2 = mockClickHouseClient.query.mock.calls[1][0];
      expect(queryCall2.query_params.tokenAddress).toBe(lowerCaseMint);
    });
  });
});
