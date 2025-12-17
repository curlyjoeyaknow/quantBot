import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConsoleSink } from '../../../src/sinks/console-sink';
import type { SimulationRunContext } from '../../../src/core';

describe('Console Sink', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('should output summary by default', async () => {
    const sink = new ConsoleSink();
    const context: SimulationRunContext = {
      scenario: { name: 'test', strategy: [] },
      target: {
        mint: 'test',
        chain: 'solana',
        startTime: {} as any,
        endTime: {} as any,
      },
      candles: [],
      result: {
        finalPnl: 1.5,
        events: [],
        entryPrice: 1.0,
        finalPrice: 1.5,
        totalCandles: 100,
        entryOptimization: {
          lowestPrice: 1.0,
          lowestPriceTimestamp: 1000,
          lowestPricePercent: 0,
          lowestPriceTimeFromEntry: 0,
          trailingEntryUsed: false,
          actualEntryPrice: 1.0,
          entryDelay: 0,
        },
      },
    };

    await sink.handle(context);
    expect(consoleLogSpy).toHaveBeenCalled();
  });

  it('should output detailed format when configured', async () => {
    const sink = new ConsoleSink({ detail: 'detailed' });
    const context: SimulationRunContext = {
      scenario: { name: 'test', strategy: [] },
      target: {
        mint: 'test',
        chain: 'solana',
        startTime: {} as any,
        endTime: {} as any,
      },
      candles: [],
      result: {
        finalPnl: 1.5,
        events: [],
        entryPrice: 1.0,
        finalPrice: 1.5,
        totalCandles: 100,
        entryOptimization: {
          lowestPrice: 1.0,
          lowestPriceTimestamp: 1000,
          lowestPricePercent: 0,
          lowestPriceTimeFromEntry: 0,
          trailingEntryUsed: false,
          actualEntryPrice: 1.0,
          entryDelay: 0,
        },
      },
    };

    await sink.handle(context);
    expect(consoleLogSpy).toHaveBeenCalled();
  });
});
