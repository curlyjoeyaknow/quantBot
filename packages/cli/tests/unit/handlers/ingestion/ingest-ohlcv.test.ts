/**
 * Unit tests for ingestOhlcvHandler
 *
 * Tests that the handler is a pure use-case function:
 * - No Commander involved
 * - No output formatting
 * - No process.exit
 * - Dependencies are injected (fake context)
 * - Pure orchestration + correct parameter translation
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

// Mock jobs
vi.mock('@quantbot/jobs', () => ({
  OhlcvBirdeyeFetch: class {
    constructor(_config: unknown) {
      // Mock constructor
    }
  },
}));

describe('ingestOhlcvHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set default DUCKDB_PATH for tests
    process.env.DUCKDB_PATH = '/tmp/test.duckdb';
  });

  it('calls ingestOhlcv workflow with correct spec', async () => {
    const mockResult = {
      tokensProcessed: 2,
      tokensSucceeded: 2,
      tokensFailed: 0,
      tokensSkipped: 0,
      tokensNoData: 0,
      candlesFetched1m: 100,
      candlesFetched5m: 500,
      chunksFromCache: 5,
      chunksFromAPI: 10,
      errors: [],
    };

    mockIngestOhlcv.mockResolvedValue(mockResult);
    mockCreateOhlcvIngestionContext.mockResolvedValue({} as any);

    const fakeCtx = {
      services: {},
    } as any;

    const args = {
      from: '2025-01-01T00:00:00.000Z',
      to: '2025-01-02T00:00:00.000Z',
      preWindow: 260,
      postWindow: 1440,
      interval: '5m' as const,
      format: 'json' as const,
      duckdb: '/tmp/test.duckdb',
    };

    const result = await ingestOhlcvHandler(args, fakeCtx);

    expect(mockIngestOhlcv).toHaveBeenCalledTimes(1);
    const spec = mockIngestOhlcv.mock.calls[0][0];

    expect(spec.preWindowMinutes).toBe(260);
    expect(spec.postWindowMinutes).toBe(1440);
    expect(spec.from).toBe(args.from);
    expect(spec.to).toBe(args.to);
    expect(spec.interval).toBe('5m');

    expect(result).toEqual(mockResult);
  });

  it('passes undefined from/to when not provided', async () => {
    mockIngestOhlcv.mockResolvedValue({
      tokensProcessed: 0,
      tokensSucceeded: 0,
      tokensFailed: 0,
      tokensSkipped: 0,
      tokensNoData: 0,
      candlesFetched1m: 0,
      candlesFetched5m: 0,
      chunksFromCache: 0,
      chunksFromAPI: 0,
      errors: [],
    });

    const fakeCtx = {
      services: {},
    } as any;

    const args = {
      preWindow: 260,
      postWindow: 1440,
      interval: '5m' as const,
      format: 'table' as const,
      duckdb: '/tmp/test.duckdb',
    };

    await ingestOhlcvHandler(args, fakeCtx);

    const spec = mockIngestOhlcv.mock.calls[0][0];
    expect(spec.from).toBeUndefined();
    expect(spec.to).toBeUndefined();
    expect(spec.preWindowMinutes).toBe(260);
    expect(spec.postWindowMinutes).toBe(1440);
  });

  it('handles interval option and maps to workflow format', async () => {
    mockIngestOhlcv.mockResolvedValue({
      worklistGenerated: 1,
      workItemsProcessed: 1,
      workItemsSucceeded: 1,
      workItemsFailed: 0,
      workItemsSkipped: 0,
      totalCandlesFetched: 50,
      totalCandlesStored: 50,
      errors: [],
      startedAtISO: '2025-01-01T00:00:00.000Z',
      completedAtISO: '2025-01-01T00:01:00.000Z',
      durationMs: 60000,
    });

    const fakeCtx = {
      services: {},
    } as any;

    // Test with different interval values including 1s
    const intervals: Array<'1s' | '15s' | '1m' | '5m' | '15m' | '1h'> = [
      '1s',
      '15s',
      '1m',
      '5m',
      '15m',
      '1h',
    ];
    const expectedWorkflowIntervals = ['1s', '15s', '1m', '5m', '5m', '1H']; // 15m maps to 5m, 1s passes through

    for (let i = 0; i < intervals.length; i++) {
      const interval = intervals[i];
      const args = {
        preWindow: 260,
        postWindow: 1440,
        interval,
        format: 'json' as const,
        duckdb: '/tmp/test.duckdb',
      };

      await ingestOhlcvHandler(args, fakeCtx);

      const spec = mockIngestOhlcv.mock.calls[i][0];
      expect(spec.interval).toBe(expectedWorkflowIntervals[i]);
    }

    expect(mockIngestOhlcv).toHaveBeenCalledTimes(intervals.length);
  });

  it('passes 1s interval through to workflow (not mapped to 15s)', async () => {
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

    const args = {
      preWindow: 52, // For 1s, this is treated as seconds
      postWindow: 5000,
      interval: '1s' as const,
      format: 'json' as const,
      duckdb: '/tmp/test.duckdb',
    };

    await ingestOhlcvHandler(args, fakeCtx);

    const spec = mockIngestOhlcv.mock.calls[0][0];
    // CRITICAL: 1s should pass through, not be mapped to 15s
    expect(spec.interval).toBe('1s');
  });

  it('propagates workflow errors without catching them', async () => {
    const workflowError = new Error('Workflow failed: database connection lost');
    mockIngestOhlcv.mockRejectedValue(workflowError);

    const fakeCtx = {
      services: {},
    } as any;

    const args = {
      preWindow: 260,
      postWindow: 1440,
      interval: '5m' as const,
      format: 'json' as const,
      duckdb: '/tmp/test.duckdb',
    };

    // Handler should let errors bubble up (no try/catch)
    await expect(ingestOhlcvHandler(args, fakeCtx)).rejects.toThrow(
      'Workflow failed: database connection lost'
    );
    expect(mockIngestOhlcv).toHaveBeenCalledTimes(1);
  });

  it('passes date strings to workflow (workflow handles validation)', async () => {
    mockIngestOhlcv.mockResolvedValue({
      tokensProcessed: 0,
      tokensSucceeded: 0,
      tokensFailed: 0,
      tokensSkipped: 0,
      tokensNoData: 0,
      candlesFetched1m: 0,
      candlesFetched5m: 0,
      chunksFromCache: 0,
      chunksFromAPI: 0,
      errors: [],
    });

    const fakeCtx = {
      services: {},
    } as any;

    // Handler passes date strings as-is to workflow
    // The workflow should handle validation
    const args = {
      from: 'not-a-date',
      to: 'also-not-a-date',
      preWindow: 260,
      postWindow: 1440,
      interval: '5m' as const,
      format: 'json' as const,
      duckdb: '/tmp/test.duckdb',
    };

    await ingestOhlcvHandler(args, fakeCtx);

    const spec = mockIngestOhlcv.mock.calls[0][0];
    // Handler passes strings as-is to workflow
    expect(spec.from).toBe('not-a-date');
    expect(spec.to).toBe('also-not-a-date');
  });
});
