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

import { describe, it, expect, vi } from 'vitest';
import { ingestOhlcvHandler } from '../../../../src/handlers/ingestion/ingest-ohlcv.js';

describe('ingestOhlcvHandler', () => {
  it('calls OhlcvIngestionService.ingestForCalls with converted dates + windows', async () => {
    const ingestForCalls = vi.fn().mockResolvedValue({
      tokensProcessed: 2,
      tokensSucceeded: 2,
      tokensFailed: 0,
      candlesFetched1m: 100,
      candlesFetched5m: 500,
      chunksFromCache: 5,
      chunksFromAPI: 10,
      errors: [],
    });

    const fakeCtx = {
      services: {
        ohlcvIngestion: () => ({ ingestForCalls }),
      },
    } as any;

    const args = {
      from: '2025-01-01T00:00:00.000Z',
      to: '2025-01-02T00:00:00.000Z',
      preWindow: 260,
      postWindow: 1440,
      interval: '5m' as const,
      format: 'json' as const,
    };

    const result = await ingestOhlcvHandler(args, fakeCtx);

    expect(ingestForCalls).toHaveBeenCalledTimes(1);

    const callArg = ingestForCalls.mock.calls[0][0];

    expect(callArg.preWindowMinutes).toBe(260);
    expect(callArg.postWindowMinutes).toBe(1440);

    // The important bit: handler does Date conversion (not leaving strings)
    expect(callArg.from).toBeInstanceOf(Date);
    expect(callArg.to).toBeInstanceOf(Date);
    expect((callArg.from as Date).toISOString()).toBe(args.from);
    expect((callArg.to as Date).toISOString()).toBe(args.to);

    expect(result).toEqual({
      tokensProcessed: 2,
      tokensSucceeded: 2,
      tokensFailed: 0,
      candlesFetched1m: 100,
      candlesFetched5m: 500,
      chunksFromCache: 5,
      chunksFromAPI: 10,
      errors: [],
    });
  });

  it('passes undefined from/to when not provided', async () => {
    const ingestForCalls = vi.fn().mockResolvedValue({
      tokensProcessed: 0,
      tokensSucceeded: 0,
      tokensFailed: 0,
      candlesFetched1m: 0,
      candlesFetched5m: 0,
      chunksFromCache: 0,
      chunksFromAPI: 0,
      errors: [],
    });

    const fakeCtx = {
      services: {
        ohlcvIngestion: () => ({ ingestForCalls }),
      },
    } as any;

    const args = {
      preWindow: 260,
      postWindow: 1440,
      interval: '5m' as const,
      format: 'table' as const,
    };

    await ingestOhlcvHandler(args, fakeCtx);

    const callArg = ingestForCalls.mock.calls[0][0];
    expect(callArg.from).toBeUndefined();
    expect(callArg.to).toBeUndefined();
    expect(callArg.preWindowMinutes).toBe(260);
    expect(callArg.postWindowMinutes).toBe(1440);
  });

  it('handles interval option (even though service does not use it yet)', async () => {
    const ingestForCalls = vi.fn().mockResolvedValue({
      tokensProcessed: 1,
      tokensSucceeded: 1,
      tokensFailed: 0,
      candlesFetched1m: 50,
      candlesFetched5m: 200,
      chunksFromCache: 2,
      chunksFromAPI: 5,
      errors: [],
    });

    const fakeCtx = {
      services: {
        ohlcvIngestion: () => ({ ingestForCalls }),
      },
    } as any;

    // Test with different interval values
    const intervals: Array<'1m' | '5m' | '15m' | '1h'> = ['1m', '5m', '15m', '1h'];

    for (const interval of intervals) {
      const args = {
        preWindow: 260,
        postWindow: 1440,
        interval,
        format: 'json' as const,
      };

      await ingestOhlcvHandler(args, fakeCtx);
    }

    // Handler should accept all interval values without error
    // (Note: service doesn't use interval yet, but handler accepts it for future compatibility)
    expect(ingestForCalls).toHaveBeenCalledTimes(intervals.length);
  });

  it('propagates service errors without catching them', async () => {
    const serviceError = new Error('Service failed: database connection lost');
    const ingestForCalls = vi.fn().mockRejectedValue(serviceError);

    const fakeCtx = {
      services: {
        ohlcvIngestion: () => ({ ingestForCalls }),
      },
    } as any;

    const args = {
      preWindow: 260,
      postWindow: 1440,
      interval: '5m' as const,
      format: 'json' as const,
    };

    // Handler should let errors bubble up (no try/catch)
    await expect(ingestOhlcvHandler(args, fakeCtx)).rejects.toThrow(
      'Service failed: database connection lost'
    );
    expect(ingestForCalls).toHaveBeenCalledTimes(1);
  });

  it('handles invalid date strings gracefully (service will handle validation)', async () => {
    const ingestForCalls = vi.fn().mockResolvedValue({
      tokensProcessed: 0,
      tokensSucceeded: 0,
      tokensFailed: 0,
      candlesFetched1m: 0,
      candlesFetched5m: 0,
      chunksFromCache: 0,
      chunksFromAPI: 0,
      errors: [],
    });

    const fakeCtx = {
      services: {
        ohlcvIngestion: () => ({ ingestForCalls }),
      },
    } as any;

    // Handler converts string to Date - invalid strings become Invalid Date objects
    // The service should handle validation, not the handler
    const args = {
      from: 'not-a-date',
      to: 'also-not-a-date',
      preWindow: 260,
      postWindow: 1440,
      interval: '5m' as const,
      format: 'json' as const,
    };

    await ingestOhlcvHandler(args, fakeCtx);

    const callArg = ingestForCalls.mock.calls[0][0];
    // Handler still converts (creates Invalid Date objects)
    // Service will handle validation/error handling
    expect(callArg.from).toBeInstanceOf(Date);
    expect(callArg.to).toBeInstanceOf(Date);
    expect(isNaN((callArg.from as Date).getTime())).toBe(true);
    expect(isNaN((callArg.to as Date).getTime())).toBe(true);
  });
});
