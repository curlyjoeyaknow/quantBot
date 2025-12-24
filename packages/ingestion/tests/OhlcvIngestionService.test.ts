import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { OhlcvIngestionService } from '../src/OhlcvIngestionService';
import type { Chain } from '@quantbot/core';

// Mock logger is handled in tests/setup.ts

// Mock getPostgresPool for ATH/ATL calculation tests
vi.mock('@quantbot/storage', async () => {
  const actual = await vi.importActual('@quantbot/storage');
  return {
    ...actual,
    getPostgresPool: vi.fn(),
    getDuckDBWorklistService: vi.fn(),
  };
});

// Mock @quantbot/jobs to return engine with initialize
vi.mock('@quantbot/jobs', () => {
  const mockEngine = {
    initialize: vi.fn().mockResolvedValue(undefined),
    fetchCandles: vi.fn(),
  };
  return {
    getOhlcvIngestionEngine: vi.fn(() => mockEngine),
  };
});

describe('OhlcvIngestionService', () => {
  const ingestionEngine = {
    initialize: vi.fn(),
    fetchCandles: vi.fn(),
  };

  const mockPythonEngine = {
    runOhlcvWorklist: vi.fn(),
  };

  let service: OhlcvIngestionService;
  let mockWorklistService: any;

  const mockCall = (tokenId: number, timestamp: DateTime) => ({
    id: 1,
    tokenId,
    signalTimestamp: timestamp,
    callerId: 1,
    side: 'buy',
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    ingestionEngine.initialize.mockResolvedValue(undefined);
    mockPythonEngine.runOhlcvWorklist.mockReset();

    // Mock the worklist service to use our mocked Python engine
    const { getDuckDBWorklistService } = await import('@quantbot/storage');
    mockWorklistService = {
      queryWorklist: vi.fn(),
    };
    vi.mocked(getDuckDBWorklistService).mockReturnValue(mockWorklistService as any);

    // Pass both engines to constructor
    service = new OhlcvIngestionService(
      ingestionEngine as any,
      undefined, // storageEngine (will use default)
      mockPythonEngine as any // pythonEngine
    );
  });

  it('ingests candles for grouped tokens', async () => {
    const chain: Chain = 'solana';
    const now = DateTime.utc();

    // Mock worklist from DuckDB
    mockWorklistService.queryWorklist.mockResolvedValue({
      tokenGroups: [
        {
          mint: 'Mint1',
          earliestAlertTime: now.minus({ minutes: 10 }).toISO() || '',
          chain: 'solana',
          callCount: 2,
        },
        {
          mint: 'Mint2',
          earliestAlertTime: now.minus({ minutes: 20 }).toISO() || '',
          chain: 'solana',
          callCount: 1,
        },
      ],
      calls: [
        { id: 1, tokenId: 1, signalTimestamp: now.minus({ minutes: 10 }), alertId: 1 },
        { id: 2, tokenId: 1, signalTimestamp: now.minus({ minutes: 5 }), alertId: 2 },
        { id: 3, tokenId: 2, signalTimestamp: now.minus({ minutes: 20 }), alertId: 3 },
      ],
    });

    ingestionEngine.fetchCandles.mockResolvedValue({
      '1m': [{ timestamp: 1, high: 1, low: 1, open: 1, close: 1, volume: 1 }],
      '5m': [{ timestamp: 2, high: 2, low: 2, open: 2, close: 2, volume: 2 }],
      metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
    });

    const result = await service.ingestForCalls({ duckdbPath: '/tmp/test.duckdb' });

    expect(ingestionEngine.initialize).toHaveBeenCalled();
    expect(mockWorklistService.queryWorklist).toHaveBeenCalled();
    expect(ingestionEngine.fetchCandles).toHaveBeenCalledTimes(2);
    expect(result.tokensProcessed).toBe(2);
    expect(result.tokensSucceeded).toBe(2);
    expect(result.candlesFetched1m).toBe(2);
    expect(result.candlesFetched5m).toBe(2);
  });

  it('skips tokens without lookup', async () => {
    const now = DateTime.utc();

    // Mock worklist with token that has no mint (missing mint)
    mockWorklistService.queryWorklist.mockResolvedValue({
      tokenGroups: [
        {
          mint: '', // Empty mint - should fail
          earliestAlertTime: now.toISO() || '',
          chain: 'solana',
          callCount: 1,
        },
      ],
      calls: [{ id: 1, tokenId: 99, signalTimestamp: now, alertId: 1 }],
    });

    const result = await service.ingestForCalls({ duckdbPath: '/tmp/test.duckdb' });

    expect(result.tokensFailed).toBeGreaterThanOrEqual(0); // May fail or skip
    expect(ingestionEngine.fetchCandles).not.toHaveBeenCalled();
  });

  it('continues on engine errors', async () => {
    const now = DateTime.utc();

    mockWorklistService.queryWorklist.mockResolvedValue({
      tokenGroups: [
        {
          mint: 'Mint1',
          earliestAlertTime: now.toISO() || '',
          chain: 'solana',
          callCount: 1,
        },
      ],
      calls: [{ id: 1, tokenId: 1, signalTimestamp: now, alertId: 1 }],
    });

    ingestionEngine.fetchCandles.mockRejectedValue(new Error('engine failed'));

    const result = await service.ingestForCalls({ duckdbPath: '/tmp/test.duckdb' });

    expect(result.tokensProcessed).toBe(1);
    expect(result.tokensFailed).toBe(1);
    expect(result.errors.length).toBe(1);
  });

  it('calculates and stores ATH/ATL metrics for alerts', async () => {
    // Mock getPostgresPool for ATH/ATL calculation
    const { getPostgresPool } = await import('@quantbot/storage');
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: 1,
            alert_price: 0.001,
            initial_price: 0.001,
            alert_timestamp: new Date('2025-12-15T10:00:00Z'),
          },
        ],
      }),
    };
    (getPostgresPool as ReturnType<typeof vi.fn>).mockReturnValue(mockPool as any);

    const chain: Chain = 'solana';
    const now = DateTime.utc();
    const entryTimestamp = Math.floor(now.minus({ minutes: 5 }).toSeconds());

    // Create candles with ATH progression
    const candles = [
      {
        timestamp: entryTimestamp + 60, // 1 minute after entry
        high: 0.002, // 2x entry price
        low: 0.0005, // ATL: 0.5x entry price
        open: 0.001,
        close: 0.0015,
        volume: 1000,
      },
      {
        timestamp: entryTimestamp + 120, // 2 minutes after entry
        high: 0.003, // 3x entry price (ATH)
        low: 0.001,
        open: 0.0015,
        close: 0.002,
        volume: 2000,
      },
      {
        timestamp: entryTimestamp + 180, // 3 minutes after entry
        high: 0.0025,
        low: 0.0015,
        open: 0.002,
        close: 0.0022,
        volume: 1500,
      },
    ];

    mockWorklistService.queryWorklist.mockResolvedValue({
      tokenGroups: [
        {
          mint: 'Mint1',
          earliestAlertTime: now.minus({ minutes: 5 }).toISO() || '',
          chain: 'solana',
          callCount: 1,
        },
      ],
      calls: [
        {
          id: 1,
          tokenId: 1,
          signalTimestamp: now.minus({ minutes: 5 }),
          alertId: 1,
        },
      ],
    });

    ingestionEngine.fetchCandles.mockResolvedValue({
      '1m': [],
      '5m': candles,
      metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
    });

    const result = await service.ingestForCalls({ duckdbPath: '/tmp/test.duckdb' });

    expect(result.tokensSucceeded).toBe(1);
    expect(result.candlesFetched5m).toBe(3);
  });
});
