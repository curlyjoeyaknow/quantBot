/**
 * Unit tests for backfill-ohlcv handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CommandContext } from '../../../../src/core/command-context.js';
import { DateTime } from 'luxon';
import { ValidationError } from '@quantbot/infra/utils';

// Mock the ingestion engine before importing the handler
const mockFetchCandles = vi.fn();
const mockInitialize = vi.fn().mockResolvedValue(undefined);

vi.mock('@quantbot/data/jobs', () => ({
  getOhlcvIngestionEngine: vi.fn(() => ({
    initialize: mockInitialize,
    fetchCandles: mockFetchCandles,
  })),
}));

// Mock ClickHouse and storage to avoid connection errors
vi.mock('@quantbot/storage', () => ({
  initClickHouse: vi.fn().mockResolvedValue(undefined),
  getStorageEngine: vi.fn(() => ({
    storeCandles: vi.fn(),
    getCandles: vi.fn(),
  })),
  OhlcvRepository: vi.fn(() => ({
    upsertCandles: vi.fn().mockResolvedValue({
      inserted: 0,
      rejected: 0,
      warnings: 0,
      rejectionDetails: [],
    }),
  })),
  IngestionRunRepository: vi.fn(() => ({
    startRun: vi.fn().mockResolvedValue(undefined),
    completeRun: vi.fn().mockResolvedValue(undefined),
    failRun: vi.fn().mockResolvedValue(undefined),
    updateRunStats: vi.fn(),
  })),
}));

vi.mock('@quantbot/infra/storage', () => ({
  getClickHouseClient: vi.fn(() => ({
    query: vi.fn(),
    insert: vi.fn(),
  })),
}));

// Import handler after mocking
import { backfillOhlcvHandler } from '../../../../src/commands/ohlcv/backfill-ohlcv.js';

type OhlcvIngestionResult = {
  candles1m: unknown[];
  candles15s: unknown[];
  candles5m: unknown[];
  metadata: {
    tokenStored: boolean;
    total1mCandles: number;
    total15sCandles: number;
    total5mCandles: number;
    chunksFetched: number;
    chunksFromCache: number;
    chunksFromAPI: number;
  };
};

describe('backfillOhlcvHandler', () => {
  let mockCtx: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx = {
      services: {},
    } as unknown as CommandContext;
  });

  it('should fetch candles for valid mint and date range', async () => {
    const mockResult: OhlcvIngestionResult = {
      candles1m: [],
      candles15s: [],
      candles5m: [],
      metadata: {
        tokenStored: true,
        total1mCandles: 100,
        total15sCandles: 0,
        total5mCandles: 50,
        chunksFetched: 2,
        chunksFromCache: 1,
        chunksFromAPI: 1,
      },
    };

    mockFetchCandles.mockResolvedValue(mockResult);

    const args = {
      mint: 'So11111111111111111111111111111111111111112',
      from: '2024-01-01T00:00:00Z',
      to: '2024-01-02T00:00:00Z',
      interval: '5m' as const,
      chain: 'solana' as const,
      format: 'table' as const,
    };

    const result = await backfillOhlcvHandler(args, mockCtx);

    expect(mockInitialize).toHaveBeenCalled();
    expect(mockFetchCandles).toHaveBeenCalledWith(
      'So11111111111111111111111111111111111111112',
      'solana',
      DateTime.fromISO('2024-01-01T00:00:00Z', { zone: 'utc' }),
      {
        useCache: true,
        forceRefresh: false,
      }
    );
    expect(result).toEqual({
      mint: 'So11111111111111111111111111111111111111112',
      chain: 'solana',
      interval: '5m',
      from: '2024-01-01T00:00:00Z',
      to: '2024-01-02T00:00:00Z',
      candlesFetched1m: 100,
      candlesFetched5m: 50,
      success: true,
    });
  });

  it('should throw ValidationError for invalid mint address', async () => {
    const args = {
      mint: 'invalid',
      from: '2024-01-01T00:00:00Z',
      to: '2024-01-02T00:00:00Z',
      interval: '5m' as const,
      chain: 'solana' as const,
      format: 'table' as const,
    };

    await expect(backfillOhlcvHandler(args, mockCtx)).rejects.toThrow(ValidationError);
  });

  it('should throw ValidationError for invalid date range', async () => {
    const args = {
      mint: 'So11111111111111111111111111111111111111112',
      from: '2024-01-02T00:00:00Z',
      to: '2024-01-01T00:00:00Z', // to before from
      interval: '5m' as const,
      chain: 'solana' as const,
      format: 'table' as const,
    };

    await expect(backfillOhlcvHandler(args, mockCtx)).rejects.toThrow(ValidationError);
    await expect(backfillOhlcvHandler(args, mockCtx)).rejects.toThrow(
      'From date must be before to date'
    );
  });

  it('should handle errors gracefully', async () => {
    const error = new Error('Fetch failed');
    mockFetchCandles.mockRejectedValue(error);

    const args = {
      mint: 'So11111111111111111111111111111111111111112',
      from: '2024-01-01T00:00:00Z',
      to: '2024-01-02T00:00:00Z',
      interval: '5m' as const,
      chain: 'solana' as const,
      format: 'table' as const,
    };

    const result = await backfillOhlcvHandler(args, mockCtx);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Fetch failed');
    expect(result.candlesFetched1m).toBe(0);
    expect(result.candlesFetched5m).toBe(0);
  });
});
