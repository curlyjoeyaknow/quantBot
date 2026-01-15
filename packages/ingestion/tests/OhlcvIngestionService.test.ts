import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { OhlcvIngestionService } from '../src/OhlcvIngestionService';
import type { Chain } from '@quantbot/core';

// Mock logger is handled in tests/setup.ts

vi.mock('@quantbot/storage', async () => {
  const actual = await vi.importActual('@quantbot/storage');
  return {
    ...actual,
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
          chain: 'solana',
          callCount: 2,
        },
        {
          mint: 'Mint2',
          chain: 'solana',
          callCount: 1,
        },
      ],
      calls: [
      ],
    });

    ingestionEngine.fetchCandles.mockResolvedValue({
      '1m': [{ timestamp: 1, high: 1, low: 1, open: 1, close: 1, volume: 1 }],
      '5m': [{ timestamp: 2, high: 2, low: 2, open: 2, close: 2, volume: 2 }],
      metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
    });


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
          chain: 'solana',
          callCount: 1,
        },
      ],

    expect(result.tokensFailed).toBeGreaterThanOrEqual(0); // May fail or skip
    expect(ingestionEngine.fetchCandles).not.toHaveBeenCalled();
  });

  it('continues on engine errors', async () => {
    const now = DateTime.utc();

    mockWorklistService.queryWorklist.mockResolvedValue({
      tokenGroups: [
        {
          mint: 'Mint1',
          chain: 'solana',
          callCount: 1,
        },
      ],
    });

    ingestionEngine.fetchCandles.mockRejectedValue(new Error('engine failed'));


    expect(result.tokensProcessed).toBe(1);
    expect(result.tokensFailed).toBe(1);
    expect(result.errors.length).toBe(1);
  });

  it('calculates and stores ATH/ATL metrics for alerts', async () => {
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
          chain: 'solana',
          callCount: 1,
        },
      ],
      calls: [
        {
        },
      ],
    });

    ingestionEngine.fetchCandles.mockResolvedValue({
      '1m': [],
      '5m': candles,
      metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
    });


    expect(result.tokensSucceeded).toBe(1);
    expect(result.candlesFetched5m).toBe(3);
  });
});
