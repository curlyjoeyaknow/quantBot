import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { OhlcvIngestionService } from '../src/OhlcvIngestionService';
import type { Chain } from '@quantbot/core';

// Mock logger to suppress expected error logs in tests
vi.mock('@quantbot/utils', async () => {
  const actual = await vi.importActual('@quantbot/utils');
  return {
    ...actual,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

// Mock getPostgresPool for ATH/ATL calculation tests
vi.mock('@quantbot/storage', async () => {
  const actual = await vi.importActual('@quantbot/storage');
  return {
    ...actual,
    getPostgresPool: vi.fn(),
  };
});

describe('OhlcvIngestionService', () => {
  const callsRepo = {
    queryBySelection: vi.fn(),
  };

  const tokensRepo = {
    findById: vi.fn(),
  };

  const alertsRepo = {
    updateAlertMetrics: vi.fn(),
  };

  const ingestionEngine = {
    initialize: vi.fn(),
    fetchCandles: vi.fn(),
  };

  const service = new OhlcvIngestionService(
    callsRepo as any,
    tokensRepo as any,
    alertsRepo as any,
    ingestionEngine as any
  );

  const mockCall = (tokenId: number, timestamp: DateTime) => ({
    id: 1,
    tokenId,
    signalTimestamp: timestamp,
    callerId: 1,
    side: 'buy',
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ingests candles for grouped tokens', async () => {
    const chain: Chain = 'solana';
    const now = DateTime.utc();
    const calls = [
      mockCall(1, now.minus({ minutes: 10 })),
      mockCall(1, now.minus({ minutes: 5 })),
      mockCall(2, now.minus({ minutes: 20 })),
    ];

    callsRepo.queryBySelection.mockResolvedValue(calls);
    tokensRepo.findById.mockImplementation((id: number) =>
      Promise.resolve({ id, address: `Mint${id}`, chain })
    );
    ingestionEngine.initialize.mockResolvedValue(undefined);
    ingestionEngine.fetchCandles.mockResolvedValue({
      '1m': [{ timestamp: 1, high: 1, low: 1, open: 1, close: 1, volume: 1 }],
      '5m': [{ timestamp: 2, high: 2, low: 2, open: 2, close: 2, volume: 2 }],
      metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
    });

    const result = await service.ingestForCalls({});

    expect(ingestionEngine.initialize).toHaveBeenCalled();
    expect(tokensRepo.findById).toHaveBeenCalledTimes(2);
    expect(ingestionEngine.fetchCandles).toHaveBeenCalledTimes(2);
    expect(result.tokensProcessed).toBe(2);
    expect(result.tokensSucceeded).toBe(2);
    expect(result.candlesFetched1m).toBe(2);
    expect(result.candlesFetched5m).toBe(2);
  });

  it('skips tokens without lookup', async () => {
    callsRepo.queryBySelection.mockResolvedValue([mockCall(99, DateTime.utc())]);
    tokensRepo.findById.mockResolvedValue(null);
    ingestionEngine.initialize.mockResolvedValue(undefined);

    const result = await service.ingestForCalls({});

    expect(result.tokensFailed).toBe(1);
    expect(ingestionEngine.fetchCandles).not.toHaveBeenCalled();
  });

  it('continues on engine errors', async () => {
    callsRepo.queryBySelection.mockResolvedValue([mockCall(1, DateTime.utc())]);
    tokensRepo.findById.mockResolvedValue({ id: 1, address: 'Mint1', chain: 'solana' });
    ingestionEngine.initialize.mockResolvedValue(undefined);
    ingestionEngine.fetchCandles.mockRejectedValue(new Error('engine failed'));

    const result = await service.ingestForCalls({});

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

    const calls = [
      {
        ...mockCall(1, now.minus({ minutes: 5 })),
        alertId: 1,
      },
    ];

    callsRepo.queryBySelection.mockResolvedValue(calls);
    tokensRepo.findById.mockResolvedValue({ id: 1, address: 'Mint1', chain });
    ingestionEngine.initialize.mockResolvedValue(undefined);
    ingestionEngine.fetchCandles.mockResolvedValue({
      '1m': [],
      '5m': candles,
      metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
    });

    const result = await service.ingestForCalls({});

    expect(result.tokensSucceeded).toBe(1);
    expect(result.candlesFetched5m).toBe(3);

    // Verify ATH/ATL calculation was called
    expect(alertsRepo.updateAlertMetrics).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        athPrice: 0.003, // Highest high
        atlPrice: 0.0005, // Lowest low before ATH
        timeToATH: expect.any(Number), // Should be ~120 seconds
        maxROI: expect.any(Number), // Should be 200% (3x - 1) * 100
      })
    );
  });
});
