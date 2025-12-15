import { describe, it, expect } from 'vitest';
import { runSimulation } from '../src/simulation/runSimulation';
import type { WorkflowContext } from '../src/types';

function createMockContext(overrides?: Partial<WorkflowContext>): WorkflowContext {
  return {
    logger: { info() {}, warn() {}, error() {} },
    repos: {
      strategies: {
        async getByName(name: string) {
          if (name !== 'TestStrat') return null;
          return { name, config: { foo: 'bar' } };
        },
      },
      calls: {
        async listByRange() {
          return [
            {
              id: 'c1',
              mint: 'So11111111111111111111111111111111111111112',
              timestampIso: '2025-01-01T00:00:00.000Z',
            },
          ];
        },
      },
      runs: {
        async createRun() {
          return 'run_123';
        },
      },
      results: {
        async upsertResult() {},
      },
    },
    ohlcv: {
      async fetchHybridCandles() {
        return [{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 1 }];
      },
    },
    simulation: {
      async simulateOnCandles() {
        return { pnlMultiple: 1.23, exitReason: 'test' };
      },
    },
    ...overrides,
  };
}

describe('workflows.runSimulation', () => {
  it('runs and returns structured output (dryRun)', async () => {
    const ctx = createMockContext();

    const res = await runSimulation(
      {
        strategyName: 'TestStrat',
        from: '2025-01-01T00:00:00.000Z',
        to: '2025-01-02T00:00:00.000Z',
        interval: '1m',
        dryRun: true,
      },
      ctx
    );

    expect(res.runId).toMatch(/^dryrun_/);
    expect(res.totals.targets).toBe(1);
    expect(res.totals.ok).toBe(1);
    expect(res.results[0].pnlMultiple).toBe(1.23);
  });

  it('fails fast if strategy is missing', async () => {
    const ctx = createMockContext({
      repos: {
        strategies: {
          async getByName() {
            return null;
          },
        },
        calls: {
          async listByRange() {
            return [];
          },
        },
        runs: {
          async createRun() {
            return 'run';
          },
        },
        results: { async upsertResult() {} },
      },
    });

    const res = await runSimulation(
      {
        strategyName: 'Nope',
        from: '2025-01-01T00:00:00.000Z',
        to: '2025-01-02T00:00:00.000Z',
        interval: '1m',
        dryRun: true,
      },
      ctx
    );

    expect(res.runId).toBe('STRATEGY_NOT_FOUND');
    expect(res.errors[0].code).toBe('STRATEGY_NOT_FOUND');
  });

  it('handles invalid date format (caught by Zod validation)', async () => {
    const ctx = createMockContext();

    // Invalid date format is caught by Zod schema validation first
    const res = await runSimulation(
      {
        strategyName: 'TestStrat',
        from: 'invalid-date',
        to: '2025-01-02T00:00:00.000Z',
        interval: '1m',
        dryRun: true,
      } as any,
      ctx
    );

    // Zod validation catches invalid datetime format
    expect(res.runId).toBe('INVALID_SPEC');
    expect(res.errors[0].code).toBe('INVALID_SPEC');
  });

  it('handles invalid date range (to <= from)', async () => {
    const ctx = createMockContext();

    const res = await runSimulation(
      {
        strategyName: 'TestStrat',
        from: '2025-01-02T00:00:00.000Z',
        to: '2025-01-01T00:00:00.000Z',
        interval: '1m',
        dryRun: true,
      },
      ctx
    );

    expect(res.runId).toBe('INVALID_RANGE');
    expect(res.errors[0].code).toBe('INVALID_RANGE');
  });

  it('handles no calls found', async () => {
    const ctx = createMockContext({
      repos: {
        strategies: {
          async getByName(name: string) {
            if (name !== 'TestStrat') return null;
            return { name, config: { foo: 'bar' } };
          },
        },
        calls: {
          async listByRange() {
            return [];
          },
        },
        runs: {
          async createRun() {
            return 'run_123';
          },
        },
        results: {
          async upsertResult() {},
        },
      },
    });

    const res = await runSimulation(
      {
        strategyName: 'TestStrat',
        from: '2025-01-01T00:00:00.000Z',
        to: '2025-01-02T00:00:00.000Z',
        interval: '1m',
        dryRun: true,
      },
      ctx
    );

    expect(res.totals.targets).toBe(0);
    expect(res.totals.ok).toBe(0);
    expect(res.totals.failed).toBe(0);
    expect(res.results).toEqual([]);
  });

  it('handles per-call errors gracefully', async () => {
    const ctx = createMockContext({
      repos: {
        strategies: {
          async getByName(name: string) {
            if (name !== 'TestStrat') return null;
            return { name, config: { foo: 'bar' } };
          },
        },
        calls: {
          async listByRange() {
            return [
              {
                id: 'c1',
                mint: 'So11111111111111111111111111111111111111112',
                timestampIso: '2025-01-01T00:00:00.000Z',
              },
              {
                id: 'c2',
                mint: 'So22222222222222222222222222222222222222223',
                timestampIso: '2025-01-01T01:00:00.000Z',
              },
            ];
          },
        },
        runs: {
          async createRun() {
            return 'run_123';
          },
        },
        results: {
          async upsertResult() {},
        },
      },
      ohlcv: {
        async fetchHybridCandles(args) {
          // Fail for second call
          if (args.mint === 'So22222222222222222222222222222222222222223') {
            throw new Error('Candle fetch failed');
          }
          return [{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 1 }];
        },
      },
      simulation: {
        async simulateOnCandles() {
          return { pnlMultiple: 1.23, exitReason: 'test' };
        },
      },
    });

    const res = await runSimulation(
      {
        strategyName: 'TestStrat',
        from: '2025-01-01T00:00:00.000Z',
        to: '2025-01-02T00:00:00.000Z',
        interval: '1m',
        dryRun: true,
      },
      ctx
    );

    expect(res.totals.targets).toBe(2);
    expect(res.totals.ok).toBe(1);
    expect(res.totals.failed).toBe(1);
    expect(res.results[0].ok).toBe(true);
    expect(res.results[1].ok).toBe(false);
    expect(res.results[1].errors?.[0].code).toBe('TARGET_FAILED');
  });

  it('handles invalid spec validation', async () => {
    const ctx = createMockContext();

    const res = await runSimulation(
      {
        strategyName: '', // Invalid: empty string
        from: '2025-01-01T00:00:00.000Z',
        to: '2025-01-02T00:00:00.000Z',
        interval: '1m',
        dryRun: true,
      } as any,
      ctx
    );

    expect(res.runId).toBe('INVALID_SPEC');
    expect(res.errors[0].code).toBe('INVALID_SPEC');
  });

  it('calculates summary statistics correctly', async () => {
    const ctx = createMockContext({
      repos: {
        strategies: {
          async getByName(name: string) {
            if (name !== 'TestStrat') return null;
            return { name, config: { foo: 'bar' } };
          },
        },
        calls: {
          async listByRange() {
            return [
              {
                id: 'c1',
                mint: 'So11111111111111111111111111111111111111112',
                timestampIso: '2025-01-01T00:00:00.000Z',
              },
              {
                id: 'c2',
                mint: 'So22222222222222222222222222222222222222223',
                timestampIso: '2025-01-01T01:00:00.000Z',
              },
              {
                id: 'c3',
                mint: 'So33333333333333333333333333333333333333334',
                timestampIso: '2025-01-01T02:00:00.000Z',
              },
            ];
          },
        },
        runs: {
          async createRun() {
            return 'run_123';
          },
        },
        results: {
          async upsertResult() {},
        },
      },
      simulation: {
        async simulateOnCandles() {
          // Return different PnL values for testing
          return { pnlMultiple: 1.5, exitReason: 'target' };
        },
      },
    });

    const res = await runSimulation(
      {
        strategyName: 'TestStrat',
        from: '2025-01-01T00:00:00.000Z',
        to: '2025-01-02T00:00:00.000Z',
        interval: '1m',
        dryRun: true,
      },
      ctx
    );

    expect(res.summary.avgPnlMultiple).toBe(1.5);
    expect(res.summary.medianPnlMultiple).toBe(1.5);
    expect(res.summary.winRate).toBe(1.0); // All > 1.0
  });

  it('persists results when not dryRun', async () => {
    let upsertCalled = false;
    const ctx = createMockContext({
      repos: {
        strategies: {
          async getByName(name: string) {
            if (name !== 'TestStrat') return null;
            return { name, config: { foo: 'bar' } };
          },
        },
        calls: {
          async listByRange() {
            return [
              {
                id: 'c1',
                mint: 'So11111111111111111111111111111111111111112',
                timestampIso: '2025-01-01T00:00:00.000Z',
              },
            ];
          },
        },
        runs: {
          async createRun() {
            return 'run_123';
          },
        },
        results: {
          async upsertResult() {
            upsertCalled = true;
          },
        },
      },
      simulation: {
        async simulateOnCandles() {
          return { pnlMultiple: 1.23, exitReason: 'test' };
        },
      },
    });

    const res = await runSimulation(
      {
        strategyName: 'TestStrat',
        from: '2025-01-01T00:00:00.000Z',
        to: '2025-01-02T00:00:00.000Z',
        interval: '1m',
        dryRun: false,
      },
      ctx
    );

    expect(res.runId).toBe('run_123');
    expect(upsertCalled).toBe(true);
    expect(res.totals.ok).toBe(1);
  });

  it('handles non-Error exceptions in error handling', async () => {
    const ctx = createMockContext({
      repos: {
        strategies: {
          async getByName(name: string) {
            if (name !== 'TestStrat') return null;
            return { name, config: { foo: 'bar' } };
          },
        },
        calls: {
          async listByRange() {
            return [
              {
                id: 'c1',
                mint: 'So11111111111111111111111111111111111111112',
                timestampIso: '2025-01-01T00:00:00.000Z',
              },
            ];
          },
        },
        runs: {
          async createRun() {
            return 'run_123';
          },
        },
        results: {
          async upsertResult() {},
        },
      },
      ohlcv: {
        async fetchHybridCandles() {
          // Throw a non-Error object
          throw 'String error';
        },
      },
      simulation: {
        async simulateOnCandles() {
          return { pnlMultiple: 1.0 };
        },
      },
    });

    const res = await runSimulation(
      {
        strategyName: 'TestStrat',
        from: '2025-01-01T00:00:00.000Z',
        to: '2025-01-02T00:00:00.000Z',
        interval: '1m',
        dryRun: true,
      },
      ctx
    );

    expect(res.totals.failed).toBe(1);
    expect(res.results[0].ok).toBe(false);
    expect(res.results[0].errors?.[0].code).toBe('TARGET_FAILED');
    expect(res.results[0].errors?.[0].message).toBe('String error');
  });
});
