import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { runSimulation } from '../../src/simulation/runSimulation.js';
import { createMockContext, mkCall, mkStrategy, candleSeries } from '../helpers/mockContext.js';
import { baseSpec } from '../fixtures/runSimulation.golden.js';

describe('workflows.runSimulation - golden suite', () => {
  it('GOLDEN: dryRun true => simulates but does not persist', async () => {
    const spec = baseSpec();
    const calls = [
      mkCall('c1', 'Brook', 'MintA', '2025-11-01T00:00:00.000Z'),
      mkCall('c2', 'Brook', 'MintB', '2025-11-02T00:00:00.000Z'),
    ];
    const ctx = createMockContext({
      calls,
      candlesByMint: {
        MintA: candleSeries(),
        MintB: candleSeries(),
      },
      simByCallId: {
        c1: { pnlMultiplier: 1.1, trades: 3 },
        c2: { pnlMultiplier: 0.9, trades: 1 },
      },
    });

    const res = await runSimulation(spec, ctx);

    expect(res.runId).toBe('run_fixed_1');
    expect(res.dryRun).toBe(true);

    expect(res.totals.callsFound).toBe(2);
    expect(res.totals.callsAttempted).toBe(2);
    expect(res.totals.callsSucceeded).toBe(2);
    expect(res.totals.callsFailed).toBe(0);
    expect(res.totals.tradesTotal).toBe(4);

    // hard expectations (independent numbers)
    expect(res.pnl.min).toBe(0.9);
    expect(res.pnl.max).toBe(1.1);
    expect(res.pnl.median).toBe(1.0); // median of [0.9,1.1] is 1.0
    expect(res.pnl.mean!).toBeCloseTo(1.0, 10);

    // persistence must NOT happen in dryRun
    expect(ctx.repos.simulationRuns.create).not.toHaveBeenCalled();
    expect(ctx.repos.simulationResults.insertMany).not.toHaveBeenCalled();
  });

  it('GOLDEN: dryRun false => persists run + results', async () => {
    const spec = { ...baseSpec(), options: { ...baseSpec().options, dryRun: false } };
    const calls = [mkCall('c1', 'Brook', 'MintA', '2025-11-01T00:00:00.000Z')];
    const ctx = createMockContext({
      calls,
      candlesByMint: {
        MintA: candleSeries(),
      },
      simByCallId: { c1: { pnlMultiplier: 1.25, trades: 5 } },
    });

    const res = await runSimulation(spec, ctx);

    expect(res.totals.callsSucceeded).toBe(1);
    expect(res.pnl.mean).toBe(1.25);

    expect(ctx.repos.simulationRuns.create).toHaveBeenCalledTimes(1);
    expect(ctx.repos.simulationResults.insertMany).toHaveBeenCalledTimes(1);

    const [runId, rows] = (ctx.repos.simulationResults.insertMany as any).mock.calls[0];
    expect(runId).toBe('run_fixed_1');
    expect(rows).toHaveLength(1);
    expect(rows[0].ok).toBe(true);
    expect(rows[0].pnlMultiplier).toBe(1.25);
  });

  it('GOLDEN: missing strategy => fails fast', async () => {
    const spec = baseSpec();
    const ctx = createMockContext({
      strategy: null,
      calls: [mkCall('c1', 'Brook', 'MintA', '2025-11-01T00:00:00.000Z')],
    });

    await expect(runSimulation(spec, ctx)).rejects.toThrow(/Strategy.*not found/);

    expect(ctx.repos.calls.list).not.toHaveBeenCalled();
    expect(ctx.ohlcv.causalAccessor.getCandlesAtTime).not.toHaveBeenCalled();
    expect(ctx.simulation.run).not.toHaveBeenCalled();
  });

  it('GOLDEN: invalid date range (to <= from) => rejects', async () => {
    const spec = {
      ...baseSpec(),
      from: DateTime.fromISO('2025-11-10T00:00:00.000Z', { zone: 'utc' }),
      to: DateTime.fromISO('2025-11-10T00:00:00.000Z', { zone: 'utc' }),
    };
    const ctx = createMockContext({ calls: [] });

    await expect(runSimulation(spec, ctx)).rejects.toThrow(/Invalid date range/);
  });

  it('GOLDEN: no calls => returns empty result, no persist, no sim', async () => {
    const spec = baseSpec();
    const ctx = createMockContext({ calls: [] });

    const res = await runSimulation(spec, ctx);

    expect(res.totals.callsFound).toBe(0);
    expect(res.totals.callsAttempted).toBe(0);
    expect(res.totals.callsSucceeded).toBe(0);
    expect(res.totals.callsFailed).toBe(0);
    expect(res.totals.tradesTotal).toBe(0);

    expect(res.pnl.mean).toBeUndefined();

    expect(ctx.ohlcv.causalAccessor.getCandlesAtTime).not.toHaveBeenCalled();
    expect(ctx.simulation.run).not.toHaveBeenCalled();
    expect(ctx.repos.simulationRuns.create).not.toHaveBeenCalled();
    expect(ctx.repos.simulationResults.insertMany).not.toHaveBeenCalled();
  });

  it('GOLDEN: per-call error => captured; workflow continues', async () => {
    const spec = baseSpec();
    const calls = [
      mkCall('c1', 'Brook', 'MintA', '2025-11-01T00:00:00.000Z'),
      mkCall('c2', 'Brook', 'MintB', '2025-11-02T00:00:00.000Z'),
      mkCall('c3', 'Brook', 'MintC', '2025-11-03T00:00:00.000Z'),
    ];
    const ctx = createMockContext({
      calls,
      candlesByMint: {
        MintA: candleSeries(),
        MintB: candleSeries(),
        MintC: candleSeries(),
      },
      simByCallId: {
        c1: { pnlMultiplier: 1.1, trades: 2 },
        c2: new Error('boom'),
        c3: { pnlMultiplier: 1.05, trades: 1 },
      },
    });

    const res = await runSimulation(spec, ctx);

    expect(res.totals.callsAttempted).toBe(3);
    expect(res.totals.callsSucceeded).toBe(2);
    expect(res.totals.callsFailed).toBe(1);

    const r2 = res.results.find((r) => r.callId === 'c2')!;
    expect(r2.ok).toBe(false);
    expect(r2.errorCode).toBe('SIMULATION_ERROR');
    expect(r2.errorMessage).toMatch(/boom/);

    // Successful pnl stats should ignore failed calls
    expect(res.pnl.min).toBe(1.05);
    expect(res.pnl.max).toBe(1.1);
    expect(res.pnl.median).toBeCloseTo(1.075, 10);
  });

  it('GOLDEN: dedupes duplicate call ids', async () => {
    const spec = baseSpec();
    const calls = [
      mkCall('dup', 'Brook', 'MintA', '2025-11-01T00:00:00.000Z'),
      mkCall('dup', 'Brook', 'MintA', '2025-11-01T00:00:00.000Z'), // duplicate
    ];
    const ctx = createMockContext({
      calls,
      candlesByMint: { MintA: candleSeries() },
      simByCallId: { dup: { pnlMultiplier: 1.2, trades: 4 } },
    });

    const res = await runSimulation(spec, ctx);

    expect(res.totals.callsFound).toBe(2);
    expect(res.totals.callsAttempted).toBe(1);
    expect(ctx.simulation.run).toHaveBeenCalledTimes(1);
  });

  it('GOLDEN: stable ordering by createdAt ascending', async () => {
    const spec = baseSpec();
    const calls = [
      mkCall('c2', 'Brook', 'MintB', '2025-11-02T00:00:00.000Z'),
      mkCall('c1', 'Brook', 'MintA', '2025-11-01T00:00:00.000Z'),
    ];
    const ctx = createMockContext({
      calls,
      simByCallId: {
        c1: { pnlMultiplier: 1.0, trades: 1 },
        c2: { pnlMultiplier: 1.0, trades: 1 },
      },
    });

    const res = await runSimulation(spec, ctx);
    expect(res.results.map((r) => r.callId)).toEqual(['c1', 'c2']);
  });

  it('GOLDEN: NO_CANDLES must be flagged and must not call simulation.run', async () => {
    const spec = baseSpec();
    const calls = [mkCall('c1', 'Brook', 'MintA', '2025-11-01T00:00:00.000Z')];
    const ctx = createMockContext({
      calls,
      candlesByMint: { MintA: [] },
    });

    const res = await runSimulation(spec, ctx);

    expect(res.totals.callsSucceeded).toBe(0);
    expect(res.totals.callsFailed).toBe(1);

    const r = res.results[0];
    expect(r).toBeDefined();
    expect(r!.ok).toBe(false);
    expect(r!.errorCode).toBe('NO_CANDLES');

    expect(ctx.simulation.run).not.toHaveBeenCalled();
  });

  it('GOLDEN: windowing must be applied to ohlcv.causalAccessor (pre/post minutes)', async () => {
    const spec = {
      ...baseSpec(),
      options: { ...baseSpec().options, preWindowMinutes: 5, postWindowMinutes: 10 },
    };
    const calls = [mkCall('c1', 'Brook', 'MintA', '2025-11-01T00:00:00.000Z')];
    const ctx = createMockContext({ calls });

    await runSimulation(spec, ctx);

    // Check that getLastClosedCandle was called with windowed start time
    // Call time: 2025-11-01T00:00:00.000Z
    // Pre-window: -5 minutes = 2025-10-31T23:55:00.000Z
    // Expected startTime (Unix timestamp): 1727826900 (2025-10-31T23:55:00.000Z)
    const getLastClosedCandleCalls = (ctx.ohlcv.causalAccessor.getLastClosedCandle as any).mock
      .calls;
    expect(getLastClosedCandleCalls.length).toBeGreaterThan(0);

    // First call should be with windowed start time
    const firstCall = getLastClosedCandleCalls[0];
    expect(firstCall[0]).toBe('MintA'); // mint
    // Check that startTime is windowed (call time - 5 minutes)
    const callTime = DateTime.fromISO('2025-11-01T00:00:00.000Z', { zone: 'utc' }).toUnixInteger();
    const windowedStartTime = callTime - 5 * 60; // 5 minutes before
    expect(firstCall[1]).toBe(windowedStartTime); // simulationTime (windowed)
  });
});
