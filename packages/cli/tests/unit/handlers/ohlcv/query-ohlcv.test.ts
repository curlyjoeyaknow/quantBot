/**
 * Unit tests for queryOhlcvHandler
 *
 * Tests that the handler is a pure use-case function:
 * - No Commander involved
 * - No output formatting
 * - No process.exit
 * - Dependencies are injected (fake context)
 * - Pure orchestration + correct parameter translation
 */

import { describe, it, expect, vi } from 'vitest';
import { DateTime } from 'luxon';
import { queryOhlcvHandler } from '../../../../src/commands/ohlcv/query-ohlcv.js';

describe('queryOhlcvHandler', () => {
  it('calls OhlcvRepository.getCandles with converted dates and parameters', async () => {
    const mockCandles = [
      {
        timestamp: 1704067200,
        open: 1.0,
        high: 1.1,
        low: 0.9,
        close: 1.05,
        volume: 1000,
      },
      {
        timestamp: 1704070800,
        open: 1.05,
        high: 1.15,
        low: 1.0,
        close: 1.1,
        volume: 1500,
      },
    ];

    const getCandles = vi.fn().mockResolvedValue(mockCandles);

    const fakeCtx = {
      services: {
        ohlcvRepository: () => ({ getCandles }),
      },
    } as any;

    const args = {
      mint: 'So11111111111111111111111111111111111111112',
      from: '2024-01-01T00:00:00.000Z',
      to: '2024-01-02T00:00:00.000Z',
      interval: '5m' as const,
      chain: 'solana' as const,
      format: 'json' as const,
    };

    const result = await queryOhlcvHandler(args, fakeCtx);

    expect(getCandles).toHaveBeenCalledTimes(1);
    const callArg = getCandles.mock.calls[0];

    expect(callArg[0]).toBe(args.mint); // mint address
    expect(callArg[1]).toBe(args.chain); // chain
    expect(callArg[2]).toBe(args.interval); // interval

    // Date range should be DateTime objects
    expect(callArg[3]).toHaveProperty('from');
    expect(callArg[3]).toHaveProperty('to');
    expect(callArg[3].from).toBeInstanceOf(DateTime);
    expect(callArg[3].to).toBeInstanceOf(DateTime);

    // Verify dates are correct (check UTC representation)
    expect(callArg[3].from.toUTC().toISO()).toBe('2024-01-01T00:00:00.000Z');
    expect(callArg[3].to.toUTC().toISO()).toBe('2024-01-02T00:00:00.000Z');

    expect(result).toEqual(mockCandles);
  });

  it('validates mint address and preserves case', async () => {
    const getCandles = vi.fn().mockResolvedValue([]);

    const fakeCtx = {
      services: {
        ohlcvRepository: () => ({ getCandles }),
      },
    } as any;

    // Mint address with specific case
    const args = {
      mint: 'So11111111111111111111111111111111111111112',
      from: '2024-01-01T00:00:00.000Z',
      to: '2024-01-02T00:00:00.000Z',
      interval: '1m' as const,
      chain: 'solana' as const,
      format: 'table' as const,
    };

    await queryOhlcvHandler(args, fakeCtx);

    // Handler should pass the validated mint address (case preserved)
    expect(getCandles).toHaveBeenCalledWith(
      args.mint, // Case preserved
      args.chain,
      args.interval,
      expect.any(Object)
    );
  });

  it('throws error for invalid from date', async () => {
    const fakeCtx = {
      services: {
        ohlcvRepository: () => ({ getCandles: vi.fn() }),
      },
    } as any;

    const args = {
      mint: 'So11111111111111111111111111111111111111112',
      from: 'not-a-date',
      to: '2024-01-02T00:00:00.000Z',
      interval: '5m' as const,
      chain: 'solana' as const,
      format: 'json' as const,
    };

    await expect(queryOhlcvHandler(args, fakeCtx)).rejects.toThrow('Invalid from date');
  });

  it('throws error for invalid to date', async () => {
    const fakeCtx = {
      services: {
        ohlcvRepository: () => ({ getCandles: vi.fn() }),
      },
    } as any;

    const args = {
      mint: 'So11111111111111111111111111111111111111112',
      from: '2024-01-01T00:00:00.000Z',
      to: 'not-a-date',
      interval: '5m' as const,
      chain: 'solana' as const,
      format: 'json' as const,
    };

    await expect(queryOhlcvHandler(args, fakeCtx)).rejects.toThrow('Invalid to date');
  });

  it('throws error when from date is after to date', async () => {
    const fakeCtx = {
      services: {
        ohlcvRepository: () => ({ getCandles: vi.fn() }),
      },
    } as any;

    const args = {
      mint: 'So11111111111111111111111111111111111111112',
      from: '2024-01-02T00:00:00.000Z',
      to: '2024-01-01T00:00:00.000Z',
      interval: '5m' as const,
      chain: 'solana' as const,
      format: 'json' as const,
    };

    await expect(queryOhlcvHandler(args, fakeCtx)).rejects.toThrow(
      'From date must be before to date'
    );
  });

  it('handles different intervals', async () => {
    const getCandles = vi.fn().mockResolvedValue([]);

    const fakeCtx = {
      services: {
        ohlcvRepository: () => ({ getCandles }),
      },
    } as any;

    const intervals: Array<'1m' | '5m' | '15m' | '1h' | '4h' | '1d'> = [
      '1m',
      '5m',
      '15m',
      '1h',
      '4h',
      '1d',
    ];

    for (const interval of intervals) {
      const args = {
        mint: 'So11111111111111111111111111111111111111112',
        from: '2024-01-01T00:00:00.000Z',
        to: '2024-01-02T00:00:00.000Z',
        interval,
        chain: 'solana' as const,
        format: 'json' as const,
      };

      await queryOhlcvHandler(args, fakeCtx);
      expect(getCandles).toHaveBeenCalledWith(args.mint, args.chain, interval, expect.any(Object));
    }

    expect(getCandles).toHaveBeenCalledTimes(intervals.length);
  });

  it('propagates repository errors without catching them', async () => {
    const repositoryError = new Error('Database connection failed');
    const getCandles = vi.fn().mockRejectedValue(repositoryError);

    const fakeCtx = {
      services: {
        ohlcvRepository: () => ({ getCandles }),
      },
    } as any;

    const args = {
      mint: 'So11111111111111111111111111111111111111112',
      from: '2024-01-01T00:00:00.000Z',
      to: '2024-01-02T00:00:00.000Z',
      interval: '5m' as const,
      chain: 'solana' as const,
      format: 'json' as const,
    };

    // Handler should let errors bubble up (no try/catch)
    await expect(queryOhlcvHandler(args, fakeCtx)).rejects.toThrow('Database connection failed');
    expect(getCandles).toHaveBeenCalledTimes(1);
  });
});
