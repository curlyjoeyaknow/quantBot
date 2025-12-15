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
      getCandles: vi.fn(async ({ mint }: { mint: string; fromISO: string; toISO: string }) => {
        return candlesByMint[mint] ?? candleSeries();
      }),
    },

    simulation: {
      run: vi.fn(
        async ({ call }: { candles: Candle[]; strategy: StrategyRecord; call: CallRecord }) => {
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
