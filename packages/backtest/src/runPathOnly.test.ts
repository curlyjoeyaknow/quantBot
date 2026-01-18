/**
 * Unit tests for runPathOnly orchestrator
 *
 * Tests Guardrail 2: Path-Only Mode
 * - Computes and persists path metrics for every eligible call
 * - No trades, no policy execution
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DateTime } from 'luxon';
import type { PathOnlyRequest, CallRecord, Interval } from './types.js';
import type { Candle, TokenAddress } from '@quantbot/core';

// Mock the dependencies
vi.mock('./plan.js', () => ({
  planBacktest: vi.fn().mockReturnValue({
    intervalSeconds: 60,
    indicatorWarmupCandles: 0,
    entryDelayCandles: 0,
    maxHoldCandles: 1440,
    totalRequiredCandles: 1440,
    perCallWindow: [
      {
        callId: 'call-1',
        tokenAddress: 'mint-abc',
        chain: 'solana',
        callTimestamp: DateTime.fromISO('2024-01-01T00:00:00Z'),
        from: DateTime.fromISO('2024-01-01T00:00:00Z'),
        to: DateTime.fromISO('2024-01-02T00:00:00Z'),
      },
    ],
  }),
}));

vi.mock('./coverage.js', () => ({
  checkCoverage: vi.fn().mockResolvedValue({
    eligible: [
      {
        callId: 'call-1',
        tokenAddress: 'mint-abc',
        chain: 'solana',
      },
    ],
    excluded: [],
  }),
}));

vi.mock('./slice.js', () => ({
  materialiseSlice: vi.fn().mockResolvedValue({
    path: '/tmp/test-slice.parquet',
    format: 'parquet',
    interval: '1m',
    callIds: ['call-1'],
  }),
}));

// Create synthetic candles for testing
function createSyntheticCandles(startTs: number): Candle[] {
  // Start at $1, go to $2.5 (hit 2x), drop to $0.9 (10% drawdown), recover
  const prices = [
    { open: 1.0, high: 1.1, low: 0.95, close: 1.0 },
    { open: 1.0, high: 1.3, low: 0.9, close: 1.2 }, // Activity: 10% move up
    { open: 1.2, high: 1.8, low: 1.1, close: 1.5 },
    { open: 1.5, high: 2.2, low: 1.4, close: 2.0 }, // Hit 2x
    { open: 2.0, high: 2.5, low: 1.8, close: 2.3 }, // Peak at 2.5
    { open: 2.3, high: 2.4, low: 2.0, close: 2.1 },
  ];

  return prices.map((p, i) => ({
    timestamp: startTs / 1000 + i * 60, // Convert ms to seconds, 1-minute intervals
    open: p.open,
    high: p.high,
    low: p.low,
    close: p.close,
    volume: 1000,
  }));
}

vi.mock('./runBacktest.js', () => ({
  loadCandlesFromSlice: vi.fn().mockImplementation(() => {
    const startTs = DateTime.fromISO('2024-01-01T00:00:00Z').toMillis();
    const candles = createSyntheticCandles(startTs);
    return Promise.resolve(new Map([['call-1', candles]]));
  }),
}));

// Mock DuckDB
vi.mock('duckdb', () => {
  const mockDb = {
    run: vi.fn((sql: string, params: unknown[], callback: (err: unknown) => void) => {
      callback(null);
    }),
    all: vi.fn(<T>(sql: string, params: unknown[], callback: (err: unknown, rows: T[]) => void) => {
      callback(null, []);
    }),
    prepare: vi.fn((sql: string, callback: (err: unknown, stmt: unknown) => void) => {
      const stmt = {
        run: vi.fn((params: unknown[], cb: (err: unknown) => void) => cb(null)),
        finalize: vi.fn((cb: () => void) => cb()),
      };
      callback(null, stmt);
    }),
  };

  // Create a mock Database class
  class MockDatabase {
    connect() {
      return mockDb;
    }
    close = vi.fn();
  }

  // duckdb exports Database on the default export object (CommonJS pattern)
  return {
    default: {
      Database: MockDatabase,
    },
  };
});

// Mock fs
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('{}'),
}));

// Mock @quantbot/utils
vi.mock('@quantbot/infra/utils', () => {
  class MockTimingContext {
    private partsMap: Record<string, number> = {};
    start = vi.fn();
    end = vi.fn();
    phaseSync = vi.fn((label: string, fn: () => unknown) => {
      this.partsMap[label] = 1; // Track phase
      return fn();
    });
    phase = vi.fn(async (label: string, fn: () => Promise<unknown>) => {
      this.partsMap[label] = 1; // Track phase
      return await fn();
    });
    get parts(): Record<string, number> {
      return { ...this.partsMap };
    }
    toJSON = vi.fn(function (this: MockTimingContext) {
      return {
        totalMs: 0,
        phases: [],
        parts: this.parts,
      };
    });
    summaryLine = vi.fn().mockReturnValue('[timing] total=0ms');
  }

  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  class MockPythonEngine {
    runScript = vi.fn();
    runScriptWithArtifacts = vi.fn();
    runTelegramPipeline = vi.fn();
    runDuckDBStorage = vi.fn();
  }

  return {
    logger: mockLogger,
    TimingContext: MockTimingContext,
    createPackageLogger: vi.fn(() => mockLogger),
    getPythonEngine: vi.fn(() => new MockPythonEngine()),
    findWorkspaceRoot: vi.fn(() => process.cwd()),
  };
});

describe('runPathOnly', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns summary with pathMetricsWritten > 0 for eligible calls', async () => {
    // Import after mocks are set up
    const { runPathOnly } = await import('./runPathOnly.js');

    const request: PathOnlyRequest = {
      calls: [
        {
          id: 'call-1',
          caller: 'TestCaller',
          mint: 'mint-abc' as TokenAddress,
          createdAt: DateTime.fromISO('2024-01-01T00:00:00Z'),
        },
      ],
      interval: '1m' as Interval,
      from: DateTime.fromISO('2024-01-01T00:00:00Z'),
      to: DateTime.fromISO('2024-01-02T00:00:00Z'),
      activityMovePct: 0.1,
    };

    const summary = await runPathOnly(request);

    expect(summary).toBeDefined();
    expect(summary.runId).toBeDefined();
    expect(summary.callsProcessed).toBe(1);
    expect(summary.callsExcluded).toBe(0);
    expect(summary.pathMetricsWritten).toBe(1);
  });

  it('returns summary with 0 metrics when no eligible calls', async () => {
    // Override coverage mock for this test
    const { checkCoverage } = await import('./coverage.js');
    vi.mocked(checkCoverage).mockResolvedValueOnce({
      eligible: [],
      excluded: [
        {
          callId: 'call-1',
          tokenAddress: 'mint-abc' as TokenAddress,
          chain: 'solana',
          reason: 'missing_range' as const,
        },
      ],
    });

    const { runPathOnly } = await import('./runPathOnly.js');

    const request: PathOnlyRequest = {
      calls: [
        {
          id: 'call-1',
          caller: 'TestCaller',
          mint: 'mint-abc' as TokenAddress,
          createdAt: DateTime.fromISO('2024-01-01T00:00:00Z'),
        },
      ],
      interval: '1m' as Interval,
      from: DateTime.fromISO('2024-01-01T00:00:00Z'),
      to: DateTime.fromISO('2024-01-02T00:00:00Z'),
    };

    const summary = await runPathOnly(request);

    expect(summary.callsProcessed).toBe(0);
    expect(summary.callsExcluded).toBe(1);
    expect(summary.pathMetricsWritten).toBe(0);
  });
});

describe('computePathMetrics golden tests', () => {
  it('computes correct metrics for synthetic candle path hitting 2x', async () => {
    const { computePathMetrics } = await import('./metrics/path-metrics.js');

    const startTs = DateTime.fromISO('2024-01-01T00:00:00Z').toMillis();
    const candles = createSyntheticCandles(startTs);

    const metrics = computePathMetrics(candles, startTs, { activity_move_pct: 0.1 });

    // Anchor
    expect(metrics.t0_ms).toBe(startTs);
    expect(metrics.p0).toBe(1.0); // Close of first candle

    // Multiples (using high)
    expect(metrics.hit_2x).toBe(true); // Candle 4 has high=2.2
    expect(metrics.t_2x_ms).toBeDefined();
    expect(metrics.hit_3x).toBe(false); // Never reached 3x
    expect(metrics.hit_4x).toBe(false); // Never reached 4x

    // Peak
    expect(metrics.peak_multiple).toBe(2.5); // Max high / p0

    // Drawdown
    expect(metrics.dd_bps).toBeDefined();
    expect(metrics.dd_bps).toBeLessThan(0); // Min low is 0.9, which is -10% from 1.0

    // Activity
    expect(metrics.alert_to_activity_ms).toBeDefined();
    expect(metrics.alert_to_activity_ms).toBeGreaterThanOrEqual(0);
  });

  it('computes correct metrics when 2x is never hit', async () => {
    const { computePathMetrics } = await import('./metrics/path-metrics.js');

    const startTs = DateTime.fromISO('2024-01-01T00:00:00Z').toMillis();

    // Price never doubles
    const candles: Candle[] = [
      { timestamp: startTs / 1000, open: 1.0, high: 1.2, low: 0.9, close: 1.0, volume: 1000 },
      { timestamp: startTs / 1000 + 60, open: 1.0, high: 1.3, low: 0.85, close: 1.1, volume: 1000 },
      { timestamp: startTs / 1000 + 120, open: 1.1, high: 1.5, low: 1.0, close: 1.2, volume: 1000 },
      { timestamp: startTs / 1000 + 180, open: 1.2, high: 1.8, low: 1.1, close: 1.4, volume: 1000 },
    ];

    const metrics = computePathMetrics(candles, startTs, { activity_move_pct: 0.1 });

    expect(metrics.hit_2x).toBe(false);
    expect(metrics.t_2x_ms).toBeNull();
    expect(metrics.dd_to_2x_bps).toBeNull(); // Only set when 2x is hit

    // Peak is 1.8 / 1.0 = 1.8
    expect(metrics.peak_multiple).toBe(1.8);
  });

  it('handles empty candle array', async () => {
    const { computePathMetrics } = await import('./metrics/path-metrics.js');

    const startTs = DateTime.fromISO('2024-01-01T00:00:00Z').toMillis();
    const metrics = computePathMetrics([], startTs);

    expect(Number.isNaN(metrics.p0)).toBe(true);
    expect(metrics.hit_2x).toBe(false);
    expect(metrics.hit_3x).toBe(false);
    expect(metrics.hit_4x).toBe(false);
    expect(metrics.peak_multiple).toBeNull();
  });

  it('detects 4x correctly', async () => {
    const { computePathMetrics } = await import('./metrics/path-metrics.js');

    const startTs = DateTime.fromISO('2024-01-01T00:00:00Z').toMillis();

    // Price goes to 4x
    const candles: Candle[] = [
      { timestamp: startTs / 1000, open: 1.0, high: 1.0, low: 1.0, close: 1.0, volume: 1000 },
      { timestamp: startTs / 1000 + 60, open: 1.0, high: 2.5, low: 1.0, close: 2.0, volume: 1000 },
      { timestamp: startTs / 1000 + 120, open: 2.0, high: 3.5, low: 2.0, close: 3.0, volume: 1000 },
      { timestamp: startTs / 1000 + 180, open: 3.0, high: 4.5, low: 3.0, close: 4.0, volume: 1000 },
    ];

    const metrics = computePathMetrics(candles, startTs, { activity_move_pct: 0.1 });

    expect(metrics.hit_2x).toBe(true);
    expect(metrics.hit_3x).toBe(true);
    expect(metrics.hit_4x).toBe(true);
    expect(metrics.peak_multiple).toBe(4.5);
  });
});
