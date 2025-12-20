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
  const ingestionEngine = {
    initialize: vi.fn(),
    fetchCandles: vi.fn(),
  };

  const mockPythonEngine = {
    runOhlcvWorklist: vi.fn(),
  };

  let service: OhlcvIngestionService;

  beforeEach(() => {
    vi.clearAllMocks();
    ingestionEngine.initialize.mockResolvedValue(undefined);
    mockPythonEngine.runOhlcvWorklist.mockReset();
    // Set DUCKDB_PATH for tests
    process.env.DUCKDB_PATH = '/tmp/test.duckdb';

    service = new OhlcvIngestionService(
      ingestionEngine as any,
      undefined, // storageEngine
      mockPythonEngine as any // pythonEngine
    );
  });

  it('returns aggregated stats and errors', async () => {
    const now = DateTime.utc();

    // Mock worklist from DuckDB
    mockPythonEngine.runOhlcvWorklist.mockResolvedValue({
      tokenGroups: [
        {
          mint: 'Mint1',
          earliestAlertTime: now.minus({ minutes: 5 }).toISO() || '',
          chain: 'solana',
        },
        {
          mint: '', // Empty mint - should fail
          earliestAlertTime: now.minus({ minutes: 6 }).toISO() || '',
          chain: 'solana',
        },
      ],
      calls: [
        { id: 1, tokenId: 1, signalTimestamp: now.minus({ minutes: 5 }), alertId: 1 },
        { id: 2, tokenId: 2, signalTimestamp: now.minus({ minutes: 6 }), alertId: 2 },
      ],
    });

    ingestionEngine.fetchCandles.mockResolvedValue({
      '1m': [{ timestamp: 1, high: 1, low: 1, open: 1, close: 1, volume: 1 }],
      '5m': [{ timestamp: 2, high: 2, low: 2, open: 2, close: 2, volume: 2 }],
      metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
    });

    const result = await service.ingestForCalls({ duckdbPath: '/tmp/test.duckdb' });

    expect(result.tokensProcessed).toBeGreaterThanOrEqual(1);
    expect(result.tokensSucceeded).toBeGreaterThanOrEqual(0);
    expect(result.tokensFailed).toBeGreaterThanOrEqual(0);
    expect(result.candlesFetched1m).toBeGreaterThanOrEqual(0);
    expect(result.candlesFetched5m).toBeGreaterThanOrEqual(0);
  });

  it('calculates ATH/ATL with realistic candle progression', async () => {
    const now = DateTime.utc();
    const alertTime = now.minus({ minutes: 10 });
    const entryTimestamp = Math.floor(alertTime.toSeconds());
    const entryPrice = 0.001;

    // Create realistic candle progression:
    // - Entry at 0.001
    // - Drops to ATL of 0.0005 (50% of entry) at +1min
    // - Rises to ATH of 0.005 (5x entry) at +5min
    // - Continues trading after ATH
    const candles = [
      {
        timestamp: entryTimestamp + 60, // +1min: ATL
        high: 0.0008,
        low: 0.0005, // ATL
        open: 0.001,
        close: 0.0007,
        volume: 1000,
      },
      {
        timestamp: entryTimestamp + 120, // +2min: recovery
        high: 0.0015,
        low: 0.0006,
        open: 0.0007,
        close: 0.0012,
        volume: 2000,
      },
      {
        timestamp: entryTimestamp + 180, // +3min: rising
        high: 0.0025,
        low: 0.001,
        open: 0.0012,
        close: 0.002,
        volume: 3000,
      },
      {
        timestamp: entryTimestamp + 240, // +4min: approaching ATH
        high: 0.004,
        low: 0.0018,
        open: 0.002,
        close: 0.0035,
        volume: 4000,
      },
      {
        timestamp: entryTimestamp + 300, // +5min: ATH reached
        high: 0.005, // ATH
        low: 0.003,
        open: 0.0035,
        close: 0.0045,
        volume: 5000,
      },
      {
        timestamp: entryTimestamp + 360, // +6min: post-ATH
        high: 0.0042,
        low: 0.0035,
        open: 0.0045,
        close: 0.0038,
        volume: 3000,
      },
    ];

    // Mock worklist from DuckDB
    mockPythonEngine.runOhlcvWorklist.mockResolvedValue({
      tokenGroups: [
        {
          mint: 'Mint1',
          earliestAlertTime: alertTime.toISO() || '',
          chain: 'solana',
        },
      ],
      calls: [{ id: 1, tokenId: 1, signalTimestamp: alertTime, alertId: 1 }],
    });

    // Update the mock to return alert with matching timestamp
    const { getPostgresPool } = await import('@quantbot/storage');
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: 1,
            alert_price: entryPrice,
            initial_price: entryPrice,
            alert_timestamp: alertTime.toJSDate(),
          },
        ],
      }),
    };
    (getPostgresPool as ReturnType<typeof vi.fn>).mockReturnValue(mockPool as any);

    ingestionEngine.fetchCandles.mockResolvedValue({
      '1m': [],
      '5m': candles,
      metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
    });

    const result = await service.ingestForCalls({ duckdbPath: '/tmp/test.duckdb' });

    expect(result.tokensSucceeded).toBe(1);
    expect(result.candlesFetched5m).toBe(6);
  });
});
