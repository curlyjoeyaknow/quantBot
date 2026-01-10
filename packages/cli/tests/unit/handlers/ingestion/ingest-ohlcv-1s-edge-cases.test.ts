/**
 * Edge case tests for 1s interval OHLCV ingestion
 *
 * Tests edge cases specific to 1s interval:
 * - Time window calculations (seconds vs minutes)
 * - Birdeye API limitations
 * - Storage handling
 * - Error handling when 1s is not supported
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ingestOhlcvHandler } from '../../../../src/commands/ingestion/ingest-ohlcv.js';

// Mock workflows
const mockIngestOhlcv = vi.fn();
const mockCreateOhlcvIngestionContext = vi.fn();

vi.mock('@quantbot/workflows', () => ({
  ingestOhlcv: (...args: unknown[]) => mockIngestOhlcv(...args),
  createOhlcvIngestionContext: (...args: unknown[]) => mockCreateOhlcvIngestionContext(...args),
}));

describe('ingestOhlcvHandler - 1s interval edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DUCKDB_PATH = '/tmp/test.duckdb';
  });

  it('handles 1s interval with preWindow in seconds (not minutes)', async () => {
    mockIngestOhlcv.mockResolvedValue({
      worklistGenerated: 1,
      workItemsProcessed: 1,
      workItemsSucceeded: 1,
      workItemsFailed: 0,
      workItemsSkipped: 0,
      totalCandlesFetched: 5000,
      totalCandlesStored: 5000,
      errors: [],
      startedAtISO: '2025-01-01T00:00:00.000Z',
      completedAtISO: '2025-01-01T00:01:00.000Z',
      durationMs: 60000,
    });

    const fakeCtx = {
      services: {},
    } as any;

    // For 1s, preWindow of 52 means 52 seconds (not 52 minutes)
    const args = {
      preWindow: 52, // Treated as seconds for 1s interval
      postWindow: 5000,
      interval: '1s' as const,
      format: 'json' as const,
      duckdb: '/tmp/test.duckdb',
    };

    await ingestOhlcvHandler(args, fakeCtx);

    const spec = mockIngestOhlcv.mock.calls[0][0];
    expect(spec.interval).toBe('1s');
    // Workflow should receive 1s interval, worklist generation will handle time conversion
    expect(spec.preWindowMinutes).toBe(52); // Passed as-is, worklist handles conversion
  });

  it('handles 1s interval when Birdeye API returns no data gracefully', async () => {
    // Simulate Birdeye not supporting 1s for a token
    mockIngestOhlcv.mockResolvedValue({
      worklistGenerated: 1,
      workItemsProcessed: 1,
      workItemsSucceeded: 0,
      workItemsFailed: 1,
      workItemsSkipped: 0,
      totalCandlesFetched: 0,
      totalCandlesStored: 0,
      errors: [
        {
          mint: 'So11111111111111111111111111111111111111112',
          chain: 'solana',
          error: 'No 1s data returned (1s may not be supported)',
        },
      ],
      startedAtISO: '2025-01-01T00:00:00.000Z',
      completedAtISO: '2025-01-01T00:01:00.000Z',
      durationMs: 60000,
    });

    const fakeCtx = {
      services: {},
    } as any;

    const args = {
      preWindow: 52,
      postWindow: 5000,
      interval: '1s' as const,
      format: 'json' as const,
      duckdb: '/tmp/test.duckdb',
    };

    const result = await ingestOhlcvHandler(args, fakeCtx);

    expect(mockIngestOhlcv).toHaveBeenCalledTimes(1);
    expect(result).toHaveProperty('errors');
    expect((result as any).errors).toHaveLength(1);
    expect((result as any).errors[0].error).toContain('1s may not be supported');
  });

  it('handles 1s interval with very small time windows', async () => {
    mockIngestOhlcv.mockResolvedValue({
      worklistGenerated: 1,
      workItemsProcessed: 1,
      workItemsSucceeded: 1,
      workItemsFailed: 0,
      workItemsSkipped: 0,
      totalCandlesFetched: 100,
      totalCandlesStored: 100,
      errors: [],
      startedAtISO: '2025-01-01T00:00:00.000Z',
      completedAtISO: '2025-01-01T00:00:02.000Z',
      durationMs: 2000,
    });

    const fakeCtx = {
      services: {},
    } as any;

    // Very small window for 1s (100 seconds = 100 candles)
    const args = {
      preWindow: 10, // 10 seconds before
      postWindow: 100, // 100 seconds after
      interval: '1s' as const,
      format: 'json' as const,
      duckdb: '/tmp/test.duckdb',
    };

    await ingestOhlcvHandler(args, fakeCtx);

    const spec = mockIngestOhlcv.mock.calls[0][0];
    expect(spec.interval).toBe('1s');
  });

  it('handles 1s interval with large time windows (10,000 candles)', async () => {
    mockIngestOhlcv.mockResolvedValue({
      worklistGenerated: 1,
      workItemsProcessed: 1,
      workItemsSucceeded: 1,
      workItemsFailed: 0,
      workItemsSkipped: 0,
      totalCandlesFetched: 10000,
      totalCandlesStored: 10000,
      errors: [],
      startedAtISO: '2025-01-01T00:00:00.000Z',
      completedAtISO: '2025-01-01T00:03:00.000Z',
      durationMs: 180000,
    });

    const fakeCtx = {
      services: {},
    } as any;

    // Large window for 1s (10,000 seconds = ~2.78 hours)
    const args = {
      preWindow: 52, // 52 seconds before
      postWindow: 10000, // 10,000 seconds after
      interval: '1s' as const,
      format: 'json' as const,
      duckdb: '/tmp/test.duckdb',
    };

    await ingestOhlcvHandler(args, fakeCtx);

    const spec = mockIngestOhlcv.mock.calls[0][0];
    expect(spec.interval).toBe('1s');
  });

  it('distinguishes 1s from 15s interval (not mapped to 15s)', async () => {
    const results = [
      {
        worklistGenerated: 1,
        workItemsProcessed: 1,
        workItemsSucceeded: 1,
        workItemsFailed: 0,
        workItemsSkipped: 0,
        totalCandlesFetched: 5000,
        totalCandlesStored: 5000,
        errors: [],
        startedAtISO: '2025-01-01T00:00:00.000Z',
        completedAtISO: '2025-01-01T00:01:00.000Z',
        durationMs: 60000,
      },
    ];

    mockIngestOhlcv.mockResolvedValue(results[0]);

    const fakeCtx = {
      services: {},
    } as any;

    // Test 1s
    const args1s = {
      preWindow: 52,
      postWindow: 5000,
      interval: '1s' as const,
      format: 'json' as const,
      duckdb: '/tmp/test.duckdb',
    };

    await ingestOhlcvHandler(args1s, fakeCtx);
    const spec1s = mockIngestOhlcv.mock.calls[0][0];
    expect(spec1s.interval).toBe('1s');

    // Test 15s
    mockIngestOhlcv.mockResolvedValue(results[0]);
    const args15s = {
      preWindow: 52,
      postWindow: 5000,
      interval: '15s' as const,
      format: 'json' as const,
      duckdb: '/tmp/test.duckdb',
    };

    await ingestOhlcvHandler(args15s, fakeCtx);
    const spec15s = mockIngestOhlcv.mock.calls[1][0];
    expect(spec15s.interval).toBe('15s');

    // Verify they're different
    expect(spec1s.interval).not.toBe(spec15s.interval);
  });
});
