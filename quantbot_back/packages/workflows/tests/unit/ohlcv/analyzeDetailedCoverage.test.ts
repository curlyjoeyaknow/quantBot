import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import {
  analyzeDetailedCoverage,
  type AnalyzeDetailedCoverageContext,
} from '../../../src/ohlcv/analyzeDetailedCoverage.js';

describe('analyzeDetailedCoverage', () => {
  let mockContext: AnalyzeDetailedCoverageContext;

  const baseResult = {
    summary: {
      total_calls: 2,
      young_tokens: 1,
      by_interval: {
        '1m': {
          total_calls: 2,
          calls_with_sufficient_coverage: 1,
          sufficient_coverage_percent: 50,
          average_coverage_percent: 75,
        },
      },
      by_month: {
        '2025-01': {
          total_calls: 2,
          by_interval: {
            '1m': {
              total: 2,
              sufficient_coverage: 1,
              sufficient_coverage_percent: 50,
              average_coverage_percent: 75,
            },
          },
        },
      },
    },
    by_mint_caller_day: [
      {
        mint: 'mint-1',
        caller_name: 'caller',
        alert_ts_ms: 1,
        alert_datetime: '2025-01-01T00:00:00Z',
        day: '2025-01-01',
        year_month: '2025-01',
        chain: 'solana',
        is_young_token: false,
        intervals: {
          '1m': {
            coverage_percent: 90,
            expected_candles: 10,
            actual_candles: 9,
            has_sufficient_coverage: true,
          },
        },
      },
      {
        mint: 'mint-2',
        caller_name: 'caller',
        alert_ts_ms: 2,
        alert_datetime: '2025-01-02T00:00:00Z',
        day: '2025-01-02',
        year_month: '2025-01',
        chain: 'solana',
        is_young_token: true,
        intervals: {
          '1m': {
            coverage_percent: 60,
            expected_candles: 10,
            actual_candles: 6,
            has_sufficient_coverage: false,
          },
        },
      },
    ],
    metadata: {
      generated_at: '2025-01-03T00:00:00Z',
      duckdb_path: 'data/test.duckdb',
      start_month: '2025-01',
      end_month: '2025-01',
      caller_filter: null,
      total_calls_analyzed: 2,
    },
  };

  beforeEach(() => {
    mockContext = {
      pythonEngine: {
        runScript: vi.fn().mockResolvedValue(baseResult),
      } as any,
      logger: {
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      clock: {
        now: () => DateTime.fromISO('2025-01-03T00:00:00Z', { zone: 'utc' }),
      },
    };
  });

  it('truncates detailed results when limit is set', async () => {
    const result = await analyzeDetailedCoverage(
      {
        duckdbPath: 'data/test.duckdb',
        limit: 1,
      },
      mockContext
    );

    const args = (mockContext.pythonEngine.runScript as any).mock.calls[0][1];
    expect(args.limit).toBe(1);
    expect(result.by_mint_caller_day).toHaveLength(1);
  });

  it('returns summary-only output when summaryOnly is true', async () => {
    const result = await analyzeDetailedCoverage(
      {
        duckdbPath: 'data/test.duckdb',
        summaryOnly: true,
      },
      mockContext
    );

    const args = (mockContext.pythonEngine.runScript as any).mock.calls[0][1];
    expect(args['summary-only']).toBe(true);
    expect(result.by_mint_caller_day).toHaveLength(0);
  });
});
