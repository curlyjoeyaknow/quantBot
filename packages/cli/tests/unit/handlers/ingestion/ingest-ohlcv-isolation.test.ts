/**
 * Isolation Test - Litmus Test for Handler
 *
 * This test verifies the handler can be:
 * - Imported into a REPL
 * - Called with plain objects
 * - Returns deterministic results
 *
 * If this test passes, the handler is properly decoupled from CLI infrastructure.
 */

import { describe, it, expect, vi } from 'vitest';
import { ingestOhlcvHandler } from '../../../../src/handlers/ingestion/ingest-ohlcv.js';

describe('ingestOhlcvHandler - Isolation Test', () => {
  it('can be called with plain objects (no CLI infrastructure)', async () => {
    // Plain object args (as if from a REPL or script)
    const plainArgs = {
      from: '2025-01-01T00:00:00.000Z',
      to: '2025-01-02T00:00:00.000Z',
      preWindow: 260,
      postWindow: 1440,
      interval: '5m' as const,
      format: 'json' as const,
    };

    // Plain object context (minimal mock)
    const plainCtx = {
      services: {
        ohlcvIngestion: () => ({
          ingestForCalls: vi.fn().mockResolvedValue({
            tokensProcessed: 1,
            tokensSucceeded: 1,
            tokensFailed: 0,
            candlesFetched1m: 50,
            candlesFetched5m: 200,
            chunksFromCache: 2,
            chunksFromAPI: 5,
            errors: [],
          }),
        }),
      },
    } as any;

    // Call handler directly (no Commander, no execute(), no CLI)
    const result = await ingestOhlcvHandler(plainArgs, plainCtx);

    // Deterministic result
    expect(result).toEqual({
      tokensProcessed: 1,
      tokensSucceeded: 1,
      tokensFailed: 0,
      candlesFetched1m: 50,
      candlesFetched5m: 200,
      chunksFromCache: 2,
      chunksFromAPI: 5,
      errors: [],
    });
  });

  it('returns the same result for the same inputs (deterministic)', async () => {
    const args1 = {
      from: '2025-01-01T00:00:00.000Z',
      to: '2025-01-02T00:00:00.000Z',
      preWindow: 260,
      postWindow: 1440,
      interval: '5m' as const,
      format: 'json' as const,
    };

    const args2 = { ...args1 }; // Same values, different object

    const mockResult = {
      tokensProcessed: 2,
      tokensSucceeded: 2,
      tokensFailed: 0,
      candlesFetched1m: 100,
      candlesFetched5m: 500,
      chunksFromCache: 5,
      chunksFromAPI: 10,
      errors: [],
    };

    const ctx1 = {
      services: {
        ohlcvIngestion: () => ({
          ingestForCalls: vi.fn().mockResolvedValue(mockResult),
        }),
      },
    } as any;

    const ctx2 = {
      services: {
        ohlcvIngestion: () => ({
          ingestForCalls: vi.fn().mockResolvedValue(mockResult),
        }),
      },
    } as any;

    const result1 = await ingestOhlcvHandler(args1, ctx1);
    const result2 = await ingestOhlcvHandler(args2, ctx2);

    expect(result1).toEqual(result2);
    expect(result1).toEqual(mockResult);
  });
});
