import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { OhlcvIngestionService } from '../src/OhlcvIngestionService';

// Mock getPostgresPool (needed for calculateAndStoreAthAtl)
// This overrides the mock from setup.ts
vi.mock('@quantbot/storage', () => {
  const noop = vi.fn();
  class BaseRepo {}
  return {
    // Repositories (stub classes)
    CallsRepository: class extends BaseRepo {},
    TokensRepository: class extends BaseRepo {},
    AlertsRepository: class extends BaseRepo {},
    CallersRepository: class extends BaseRepo {},
    OhlcvRepository: class extends BaseRepo {},
    // Engine / clients
    getStorageEngine: vi.fn(),
    initClickHouse: vi.fn(),
    getClickHouseClient: vi.fn(),
    // Postgres pool (needed for this test)
    getPostgresPool: vi.fn(() => ({
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: 1,
            alert_price: 0.001,
            initial_price: 0.001,
            alert_timestamp: new Date(),
          },
        ],
      }),
    })),
    // Influx/Cache stubs used by @quantbot/ohlcv
    influxDBClient: {},
    ohlcvCache: {
      get: vi.fn(),
      set: vi.fn(),
      clear: vi.fn(),
    },
  };
});

describe('OhlcvIngestionService (integration-lite)', () => {
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

  let service: OhlcvIngestionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OhlcvIngestionService(
      callsRepo as any,
      tokensRepo as any,
      alertsRepo as any,
      ingestionEngine as any
    );
  });

  it('returns aggregated stats and errors', async () => {
    const now = DateTime.utc();
    callsRepo.queryBySelection.mockResolvedValue([
      { tokenId: 1, signalTimestamp: now.minus({ minutes: 5 }), alertId: 1 },
      { tokenId: 2, signalTimestamp: now.minus({ minutes: 6 }), alertId: 2 },
    ]);

    tokensRepo.findById.mockImplementation((id: number) =>
      id === 1 ? Promise.resolve({ id, address: 'Mint1', chain: 'solana' }) : Promise.resolve(null)
    );

    ingestionEngine.initialize.mockResolvedValue(undefined);
    ingestionEngine.fetchCandles.mockResolvedValue({
      '1m': [{ timestamp: 1, high: 1, low: 1, open: 1, close: 1, volume: 1 }],
      '5m': [{ timestamp: 2, high: 2, low: 2, open: 2, close: 2, volume: 2 }],
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
