import { z } from 'zod';
import { DateTime } from 'luxon';
import { ValidationError, NotFoundError } from '@quantbot/utils';
import type {
  WorkflowContext,
  SimulationRunSpec,
  SimulationRunResult,
  SimulationCallResult,
} from '../types.js';
import { createProductionContext } from '../context/createProductionContext.js';
import { emitEvent } from '../events/event-emitter.js';
import type { WorkflowContextWithEvents } from '../events/event-emitter.js';
import {
  createRunCreatedEvent,
  createInputsResolvedEvent,
  createSimulationStartedEvent,
  createSimulationCompletedEvent,
  createMetricsComputedEvent,
  createRunFailedEvent,
} from '@quantbot/core';

const isLuxonDateTime = (v: unknown): v is DateTime => {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.isValid === 'boolean' && obj.isValid === true && typeof obj.toISO === 'function'
  );
};

const SpecSchema = z.object({
  strategyName: z.string().min(1, 'strategyName is required'),
  callerName: z.string().min(1).optional(),
  from: z.custom<DateTime>(isLuxonDateTime, 'from must be a Luxon DateTime'),
  to: z.custom<DateTime>(isLuxonDateTime, 'to must be a Luxon DateTime'),
  options: z
    .object({
      dryRun: z.boolean().optional(),
      preWindowMinutes: z
        .number()
        .int()
        .min(0)
        .max(60 * 24)
        .optional(),
      postWindowMinutes: z
        .number()
        .int()
        .min(0)
        .max(60 * 24)
        .optional(),
    })
    .optional(),
});

function median(nums: number[]): number | undefined {
  if (nums.length === 0) return undefined;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[mid];
  const prev = s[mid - 1];
  const curr = s[mid];
  if (prev === undefined || curr === undefined) return undefined;
  return (prev + curr) / 2;
}

/**
 * Create default context (for testing)
 */
export function createDefaultRunSimulationContext(): WorkflowContext {
  return createProductionContext();
}

export async function runSimulation(
  spec: SimulationRunSpec,
  ctx: WorkflowContext & WorkflowContextWithEvents = createDefaultRunSimulationContext()
): Promise<SimulationRunResult> {
  const parsed = SpecSchema.safeParse(spec);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ValidationError(`Invalid simulation spec: ${msg}`, {
      spec,
      issues: parsed.error.issues,
    });
  }

  const fromISO = spec.from.toISO()!;
  const toISO = spec.to.toISO()!;
  if (spec.to <= spec.from) {
    throw new ValidationError(`Invalid date range: to must be after from`, {
      from: fromISO,
      to: toISO,
    });
  }

  const dryRun = spec.options?.dryRun ?? false;
  const preMin = spec.options?.preWindowMinutes ?? 0;
  const postMin = spec.options?.postWindowMinutes ?? 0;

  const runId = ctx.ids.newRunId();
  const now = DateTime.fromISO(ctx.clock.nowISO());

  // Emit RunCreated event
  await emitEvent(
    ctx,
    createRunCreatedEvent(
      runId,
      {
        strategy_id: spec.strategyName, // Will be updated after strategy load
        strategy_name: spec.strategyName,
        params_json: JSON.stringify(spec),
        from_iso: fromISO,
        to_iso: toISO,
        caller_name: spec.callerName,
        interval_sec: 300, // Default 5m, could be parameterized
        notes: dryRun ? 'Dry run' : undefined,
      },
      now
    )
  );

  const strategy = await ctx.repos.strategies.getByName(spec.strategyName);
  if (!strategy) {
    // Emit RunFailed event before throwing
    await emitEvent(
      ctx,
      createRunFailedEvent(
        runId,
        {
          error_code: 'STRATEGY_NOT_FOUND',
          error_message: `Strategy not found: ${spec.strategyName}`,
          phase: 'strategy_load',
        },
        DateTime.fromISO(ctx.clock.nowISO())
      )
    );
    throw new NotFoundError('Strategy', spec.strategyName);
  }

  const calls = await ctx.repos.calls.list({
    callerName: spec.callerName,
    fromISO,
    toISO,
  });

  // Dedup by call id; keep earliest instance.
  const byId = new Map<string, (typeof calls)[number]>();
  for (const c of calls) {
    if (!byId.has(c.id)) byId.set(c.id, c);
  }
  const uniqueCalls = [...byId.values()].sort(
    (a, b) => a.createdAt.toMillis() - b.createdAt.toMillis()
  );

  // Emit InputsResolved event
  await emitEvent(
    ctx,
    createInputsResolvedEvent(
      runId,
      {
        code_version: process.env.GIT_SHA || 'unknown',
        config_hash: 'TODO', // Could hash strategy config + spec
        seed: Date.now() % 1000000, // Deterministic per-run seed from timestamp
        strategy_config_hash: 'TODO', // Hash strategy config
      },
      DateTime.fromISO(ctx.clock.nowISO())
    )
  );

  // Emit SimulationStarted event
  const simulationStartTime = DateTime.fromISO(ctx.clock.nowISO());
  await emitEvent(
    ctx,
    createSimulationStartedEvent(
      runId,
      {
        phase: 'single',
        call_count: uniqueCalls.length,
      },
      simulationStartTime
    )
  );

  const results: SimulationCallResult[] = [];
  const pnlOk: number[] = [];
  let tradesTotal = 0;

  // Emit structured event instead of verbose debug log
  ctx.logger.info('Simulation run started', {
    runId,
    strategy: strategy.name,
    calls: uniqueCalls.length,
    dryRun,
  });

  for (const call of uniqueCalls) {
    const callISO = call.createdAt.toISO()!;
    try {
      // Workflow-controlled time window (conservative: window around call timestamp)
      const fromWindow = call.createdAt.minus({ minutes: preMin });
      const toWindow = call.createdAt.plus({ minutes: postMin });

      // Use causal accessor - this is the ONLY path (Gate 2 compliance).
      // It is structurally impossible to pass raw candles into simulation.run().
      const startTime = fromWindow.toUnixInteger();
      const endTime = toWindow.toUnixInteger();

      // Check if candles are available (quick check via causal accessor)
      const initialCandle = await ctx.ohlcv.causalAccessor.getLastClosedCandle(
        call.mint,
        startTime,
        '5m'
      );

      if (!initialCandle) {
        results.push({
          callId: call.id,
          mint: call.mint,
          createdAtISO: callISO,
          ok: false,
          errorCode: 'NO_CANDLES',
          errorMessage: 'No candles returned for target window',
        });
        continue;
      }

      // Run simulation with causal accessor (mandatory - no raw candles allowed)
      const sim = await ctx.simulation.run({
        candleAccessor: ctx.ohlcv.causalAccessor, // Only path - enforced by type system
        mint: call.mint,
        startTime,
        endTime,
        strategy,
        call,
      });

      pnlOk.push(sim.pnlMultiplier);
      tradesTotal += sim.trades;

      results.push({
        callId: call.id,
        mint: call.mint,
        createdAtISO: callISO,
        ok: true,
        pnlMultiplier: sim.pnlMultiplier,
        trades: sim.trades,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({
        callId: call.id,
        mint: call.mint,
        createdAtISO: callISO,
        ok: false,
        errorCode: 'SIMULATION_ERROR',
        errorMessage: msg,
      });
      // Continue (per-call errors should not kill the run)
      // Only log errors, not warnings for per-call failures (too verbose)
      ctx.logger.error('Simulation call failed', {
        runId,
        callId: call.id,
        mint: call.mint,
        error: msg,
      });
    }
  }

  const callsAttempted = uniqueCalls.length;
  const callsSucceeded = results.filter((r) => r.ok).length;
  const callsFailed = results.length - callsSucceeded;

  const pnlMin = pnlOk.length ? Math.min(...pnlOk) : undefined;
  const pnlMax = pnlOk.length ? Math.max(...pnlOk) : undefined;
  const pnlMean = pnlOk.length ? pnlOk.reduce((a, b) => a + b, 0) / pnlOk.length : undefined;
  const pnlMedian = median(pnlOk);

  const simulationEndTime = DateTime.fromISO(ctx.clock.nowISO());
  const durationMs = simulationEndTime.diff(simulationStartTime).as('milliseconds');

  // Emit SimulationCompleted event
  await emitEvent(
    ctx,
    createSimulationCompletedEvent(
      runId,
      {
        phase: 'single',
        calls_attempted: callsAttempted,
        calls_succeeded: callsSucceeded,
        calls_failed: callsFailed,
        trades_total: tradesTotal,
        duration_ms: Math.round(durationMs),
      },
      simulationEndTime
    )
  );

  // Emit MetricsComputed event
  await emitEvent(
    ctx,
    createMetricsComputedEvent(
      runId,
      {
        metrics_type: 'aggregate',
        pnl_stats: {
          min: pnlMin,
          max: pnlMax,
          mean: pnlMean,
          median: pnlMedian,
        },
      },
      simulationEndTime
    )
  );

  if (!dryRun) {
    await ctx.repos.simulationRuns.create({
      runId,
      strategyId: strategy.id,
      strategyName: strategy.name,
      strategyConfig: strategy.config, // Store full config for reproducibility
      fromISO,
      toISO,
      callerName: spec.callerName,
      totalCalls: callsAttempted,
      successfulCalls: callsSucceeded,
      failedCalls: callsFailed,
      totalTrades: tradesTotal,
      pnlStats: {
        min: pnlMin,
        max: pnlMax,
        mean: pnlMean,
        median: pnlMedian,
      },
    });

    await ctx.repos.simulationResults.insertMany(runId, results);
  }

  // Emit structured completion event
  ctx.logger.info('Simulation run completed', {
    runId,
    callsFound: calls.length,
    callsUnique: uniqueCalls.length,
    callsSucceeded,
    callsFailed,
    tradesTotal,
    dryRun,
  });

  return {
    runId,
    strategyName: spec.strategyName,
    callerName: spec.callerName,
    fromISO,
    toISO,
    dryRun,
    totals: {
      callsFound: calls.length,
      callsAttempted,
      callsSucceeded,
      callsFailed,
      tradesTotal,
    },
    pnl: {
      min: pnlMin,
      max: pnlMax,
      mean: pnlMean,
      median: pnlMedian,
    },
    results,
  };
}
