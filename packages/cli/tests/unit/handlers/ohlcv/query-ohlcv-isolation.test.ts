/**
 * Isolation Test - Litmus Test for queryOhlcvHandler
 *
 * This test verifies the handler can be:
 * - Imported into a REPL
 * - Called with plain objects
 * - Returns deterministic results
 *
 * If this test passes, the handler is properly decoupled from CLI infrastructure.
 */

import { describe, it, expect, vi } from 'vitest';
import { queryOhlcvHandler } from '../../../../src/handlers/ohlcv/query-ohlcv.js';

describe('queryOhlcvHandler - Isolation Test', () => {
  it('can be called with plain objects (no CLI infrastructure)', async () => {
    // Plain object args (as if from a REPL or script)
    const plainArgs = {
      mint: 'So11111111111111111111111111111111111111112',
      from: '2024-01-01T00:00:00.000Z',
      to: '2024-01-02T00:00:00.000Z',
      interval: '5m' as const,
      chain: 'solana' as const,
      format: 'json' as const,
    };

    // Plain object context (minimal mock)
    const plainCtx = {
      services: {
        ohlcvRepository: () => ({
          getCandles: vi.fn().mockResolvedValue([
            {
              timestamp: 1704067200,
              open: 1.0,
              high: 1.1,
              low: 0.9,
              close: 1.05,
              volume: 1000,
            },
          ]),
        }),
      },
    } as any;

    // Call handler directly (no Commander, no execute(), no CLI)
    const result = await queryOhlcvHandler(plainArgs, plainCtx);

    // Deterministic result
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty('timestamp');
    expect(result[0]).toHaveProperty('open');
    expect(result[0]).toHaveProperty('high');
    expect(result[0]).toHaveProperty('low');
    expect(result[0]).toHaveProperty('close');
    expect(result[0]).toHaveProperty('volume');
  });

  it('returns the same result for the same inputs (deterministic)', async () => {
    const args1 = {
      mint: 'So11111111111111111111111111111111111111112',
      from: '2024-01-01T00:00:00.000Z',
      to: '2024-01-02T00:00:00.000Z',
      interval: '5m' as const,
      chain: 'solana' as const,
      format: 'table' as const,
    };

    const args2 = { ...args1 }; // Same values, different object

    const mockResult = [
      {
        timestamp: 1704067200,
        open: 1.0,
        high: 1.1,
        low: 0.9,
        close: 1.05,
        volume: 1000,
      },
    ];

    const ctx1 = {
      services: {
        ohlcvRepository: () => ({
          getCandles: vi.fn().mockResolvedValue(mockResult),
        }),
      },
    } as any;

    const ctx2 = {
      services: {
        ohlcvRepository: () => ({
          getCandles: vi.fn().mockResolvedValue(mockResult),
        }),
      },
    } as any;

    const result1 = await queryOhlcvHandler(args1, ctx1);
    const result2 = await queryOhlcvHandler(args2, ctx2);

    expect(result1).toEqual(result2);
    expect(result1).toEqual(mockResult);
  });
});

