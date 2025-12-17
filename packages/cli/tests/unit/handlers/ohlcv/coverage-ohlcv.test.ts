/**
 * Unit tests for coverage-ohlcv handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { coverageOhlcvHandler } from '../../../../src/handlers/ohlcv/coverage-ohlcv.js';
import type { CommandContext } from '../../../../src/core/command-context.js';
import { getClickHouseClient } from '@quantbot/storage';

// Mock ClickHouse client
vi.mock('@quantbot/storage', async () => {
  const actual = await vi.importActual('@quantbot/storage');
  return {
    ...actual,
    getClickHouseClient: vi.fn(),
  };
});

describe('coverageOhlcvHandler', () => {
  let mockClient: any;
  let mockCtx: CommandContext;

  beforeEach(() => {
    mockClient = {
      query: vi.fn(),
    };

    vi.mocked(getClickHouseClient).mockReturnValue(mockClient);

    mockCtx = {
      services: {},
    } as unknown as CommandContext;
  });

  it('should return coverage statistics without filters', async () => {
    // Mock count query
    mockClient.query.mockResolvedValueOnce({
      json: async () => [{ count: '1000' }],
    });

    // Mock date range query
    mockClient.query.mockResolvedValueOnce({
      json: async () => [
        {
          earliest: '2024-01-01 00:00:00',
          latest: '2024-01-31 23:59:59',
        },
      ],
    });

    // Mock chains query
    mockClient.query.mockResolvedValueOnce({
      json: async () => [{ chain: 'solana' }, { chain: 'ethereum' }],
    });

    // Mock intervals query
    mockClient.query.mockResolvedValueOnce({
      json: async () => [{ interval: '1m' }, { interval: '5m' }],
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

    // Mock count query
    mockClient.query.mockResolvedValueOnce({
      json: async () => [{ count: '500' }],
    });

    // Mock date range query
    mockClient.query.mockResolvedValueOnce({
      json: async () => [
        {
          earliest: '2024-01-01 00:00:00',
          latest: '2024-01-15 23:59:59',
        },
      ],
    });

    // Mock chains query
    mockClient.query.mockResolvedValueOnce({
      json: async () => [{ chain: 'solana' }],
    });

    // Mock intervals query
    mockClient.query.mockResolvedValueOnce({
      json: async () => [{ interval: '5m' }],
    });

    const args = {
      mint,
      format: 'table' as const,
    };

    const result = await coverageOhlcvHandler(args, mockCtx);

    expect(result.mint).toBe(mint);
    expect(result.totalCandles).toBe(500);
    expect(mockClient.query).toHaveBeenCalledTimes(4);
  });

  it('should filter by interval when provided', async () => {
    // Mock count query
    mockClient.query.mockResolvedValueOnce({
      json: async () => [{ count: '200' }],
    });

    // Mock date range query
    mockClient.query.mockResolvedValueOnce({
      json: async () => [
        {
          earliest: '2024-01-01 00:00:00',
          latest: '2024-01-10 23:59:59',
        },
      ],
    });

    // Mock chains query
    mockClient.query.mockResolvedValueOnce({
      json: async () => [{ chain: 'solana' }],
    });

    // Mock intervals query
    mockClient.query.mockResolvedValueOnce({
      json: async () => [{ interval: '1m' }],
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

