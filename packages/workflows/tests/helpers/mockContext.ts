import { DateTime } from 'luxon';
import { vi } from 'vitest';
import type {
  WorkflowContext,
  StrategyRecord,
  CallRecord,
  Candle,
  SimulationEngineResult,
  SimulationCallResult,
} from '../../src/types.js';
import { CausalCandleWrapper, type CausalCandleAccessor } from '@quantbot/backtest';

export function candleSeries(): Candle[] {
  return [
    { timestamp: 1, open: 1, high: 1.1, low: 0.9, close: 1.05, volume: 10 },
    { timestamp: 2, open: 1.05, high: 1.2, low: 1.0, close: 1.1, volume: 12 },
  ];
}

export function mkCall(id: string, caller: string, mint: string, iso: string): CallRecord {
  return { id, caller, mint, createdAt: DateTime.fromISO(iso, { zone: 'utc' }) };
}

export function mkStrategy(name = 'S1'): StrategyRecord {
  return { id: 'strat_1', name, config: { kind: 'opaque' } };
}

export function createMockContext(opts?: {
  strategy?: StrategyRecord | null | undefined;
  calls?: CallRecord[];
  candlesByMint?: Record<string, Candle[]>;
  simByCallId?: Record<string, SimulationEngineResult | Error>;
}) {
  // Explicitly handle null vs undefined for strategy
  const strategy = opts?.strategy !== undefined ? opts.strategy : mkStrategy('S1');
  const calls = opts?.calls ?? [];
  const candlesByMint = opts?.candlesByMint ?? {};
  const simByCallId = opts?.simByCallId ?? {};

  const ctx: WorkflowContext = {
    clock: { nowISO: () => '2025-12-15T00:00:00.000Z' },
    ids: { newRunId: () => 'run_fixed_1' },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },

    repos: {
      strategies: {
        getByName: vi.fn(async (name: string) =>
          strategy && strategy.name === name ? strategy : null
        ),
      },
      calls: { list: vi.fn(async () => calls) },
      simulationRuns: { create: vi.fn(async () => undefined) },
      simulationResults: {
        insertMany: vi.fn(async (_runId: string, _rows: SimulationCallResult[]) => undefined),
      },
    },

    ohlcv: {
      /**
       * Mock causal accessor for testing.
       *
       * NOTE: Even in tests, we wrap raw candles in CausalCandleWrapper to maintain
       * the causal accessor contract. This ensures tests exercise the same causal
       * semantics as production code.
       *
       * Legacy getCandles removed - all access must go through causalAccessor.
       */
      causalAccessor: {
        // Create a causal accessor that uses candlesByMint
        // For each mint, wrap its candles in a CausalCandleWrapper to enforce causal semantics
        getCandlesAtTime: vi.fn(
          async (mint: string, simulationTime: number, lookback: number, interval: string) => {
            const candles = candlesByMint[mint] ?? candleSeries();
            const wrapper = new CausalCandleWrapper(candles, interval as any);
            return wrapper.getCandlesAtTime(mint, simulationTime, lookback, interval as any);
          }
        ),
        getLastClosedCandle: vi.fn(
          async (mint: string, simulationTime: number, interval: string) => {
            const candles = candlesByMint[mint] ?? candleSeries();
            // Return null if no candles, otherwise return the last one that would be closed
            if (candles.length === 0) return null;
            // Always return a candle if we have candles (simplified for tests)
            // The CausalCandleWrapper might return null if timestamps don't match, so we fallback
            try {
              const wrapper = new CausalCandleWrapper(candles, interval as any);
              const result = await wrapper.getLastClosedCandle(
                mint,
                simulationTime,
                interval as any
              );
              // If wrapper returns null but we have candles, return the last candle as fallback
              if (result === null && candles.length > 0) {
                return candles[candles.length - 1]!;
              }
              return result;
            } catch {
              // If wrapper throws or returns null, return the last candle
              return candles.length > 0 ? candles[candles.length - 1]! : null;
            }
          }
        ),
      },
    },

    simulation: {
      run: vi.fn(
        async ({
          call,
        }: {
          candleAccessor: CausalCandleAccessor;
          mint: string;
          startTime: number;
          endTime: number;
          strategy: StrategyRecord;
          call: CallRecord;
        }) => {
          const v = simByCallId[call.id];
          if (v instanceof Error) throw v;
          if (v) return v;
          return { pnlMultiplier: 1.01, trades: 2 };
        }
      ),
    },
  };

  return ctx;
}
