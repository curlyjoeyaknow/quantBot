import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { OhlcvIngestionService } from '../src/OhlcvIngestionService';
import type { Chain } from '@quantbot/core';

describe('OhlcvIngestionService', () => {
  const callsRepo = {
    queryBySelection: vi.fn(),
  };

  const tokensRepo = {
    findById: vi.fn(),
  };

  const alertsRepo = {
    // Add any methods used by the service
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
      '1m': [{ timestamp: 1 }],
      '5m': [{ timestamp: 2 }],
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
});
