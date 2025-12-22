/**
 * Unit tests for coverage-ohlcv handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { coverageOhlcvHandler } from '../../../../src/commands/ohlcv/coverage-ohlcv.js';
import type { CommandContext } from '../../../../src/core/command-context.js';

describe('coverageOhlcvHandler', () => {
  let mockClient: any;
  let mockCtx: CommandContext;

  beforeEach(() => {
    mockClient = {
      query: vi.fn(),
    };

    mockCtx = {
      services: {
        clickHouseClient: () => mockClient,
      },
    } as unknown as CommandContext;
  });

  it('should return coverage statistics without filters', async () => {
    // Mock single combined query (handler uses groupArray to get all stats in one query)
    mockClient.query.mockResolvedValueOnce({
      json: async () => [
        {
          total_candles: 1000,
          earliest: '2024-01-01 00:00:00',
          latest: '2024-01-31 23:59:59',
          chains: ['solana', 'ethereum'],
          intervals: ['1m', '5m'],
        },
      ],
    });

    const args = {
      format: 'table' as const,
    };

    const result = await coverageOhlcvHandler(args, mockCtx);

    expect(result).toEqual({
      totalCandles: 1000,
      dateRange: {
        earliest: '2024-01-01 00:00:00',
        latest: '2024-01-31 23:59:59',
      },
      chains: ['solana', 'ethereum'],
      intervals: ['1m', '5m'],
    });
  });

  it('should filter by mint when provided', async () => {
    const mint = 'So11111111111111111111111111111111111111112';

    // Mock single combined query with mint filter
    mockClient.query.mockResolvedValueOnce({
      json: async () => [
        {
          total_candles: 500,
          earliest: '2024-01-01 00:00:00',
          latest: '2024-01-15 23:59:59',
          chains: ['solana'],
          intervals: ['5m'],
        },
      ],
    });

    const args = {
      mint,
      format: 'table' as const,
    };

    const result = await coverageOhlcvHandler(args, mockCtx);

    expect(result.mint).toBe(mint);
    expect(result.totalCandles).toBe(500);
    expect(mockClient.query).toHaveBeenCalledTimes(1);
  });

  it('should filter by interval when provided', async () => {
    // Mock single combined query with interval filter
    mockClient.query.mockResolvedValueOnce({
      json: async () => [
        {
          total_candles: 200,
          earliest: '2024-01-01 00:00:00',
          latest: '2024-01-10 23:59:59',
          chains: ['solana'],
          intervals: ['1m'],
        },
      ],
    });

    const args = {
      interval: '1m' as const,
      format: 'table' as const,
    };

    const result = await coverageOhlcvHandler(args, mockCtx);

    expect(result.interval).toBe('1m');
    expect(result.totalCandles).toBe(200);
  });

  it('should handle zero candles gracefully', async () => {
    // Mock count query
    mockClient.query.mockResolvedValueOnce({
      json: async () => [{ count: '0' }],
    });

    // Mock chains query (date range query skipped when count is 0)
    mockClient.query.mockResolvedValueOnce({
      json: async () => [],
    });

    // Mock intervals query
    mockClient.query.mockResolvedValueOnce({
      json: async () => [],
    });

    const args = {
      format: 'table' as const,
    };

    const result = await coverageOhlcvHandler(args, mockCtx);

    expect(result.totalCandles).toBe(0);
    expect(result.dateRange).toBeUndefined();
    expect(result.chains).toEqual([]);
    expect(result.intervals).toEqual([]);
  });

  it('should validate mint address when provided', async () => {
    const args = {
      mint: 'invalid',
      format: 'table' as const,
    };

    await expect(coverageOhlcvHandler(args, mockCtx)).rejects.toThrow();
  });
});
