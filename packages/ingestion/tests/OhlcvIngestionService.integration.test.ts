import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { OhlcvIngestionService } from '../src/OhlcvIngestionService';

describe('OhlcvIngestionService (integration-lite)', () => {
  const callsRepo = {
    queryBySelection: vi.fn(),
  };
  const tokensRepo = {
    findById: vi.fn(),
  };
  const ingestionEngine = {
    initialize: vi.fn(),
    fetchCandles: vi.fn(),
  };

  let service: OhlcvIngestionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OhlcvIngestionService(
      callsRepo as any,
      tokensRepo as any,
      ingestionEngine as any
    );
  });

  it('returns aggregated stats and errors', async () => {
    const now = DateTime.utc();
    callsRepo.queryBySelection.mockResolvedValue([
      { tokenId: 1, signalTimestamp: now.minus({ minutes: 5 }) },
      { tokenId: 2, signalTimestamp: now.minus({ minutes: 6 }) },
    ]);

    tokensRepo.findById.mockImplementation((id: number) =>
      id === 1 ? Promise.resolve({ id, address: 'Mint1', chain: 'solana' }) : Promise.resolve(null)
    );

    ingestionEngine.initialize.mockResolvedValue(undefined);
    ingestionEngine.fetchCandles.mockResolvedValue({
      '1m': [{ timestamp: 1 }],
      '5m': [{ timestamp: 2 }],
      metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
    });

    const result = await service.ingestForCalls({});

    expect(result.tokensProcessed).toBe(2);
    expect(result.tokensSucceeded).toBe(1);
    expect(result.tokensFailed).toBe(1);
    expect(result.errors.length).toBe(1);
    expect(result.candlesFetched1m).toBe(1);
    expect(result.candlesFetched5m).toBe(1);
  });
});
