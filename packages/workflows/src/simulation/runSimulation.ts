import { z } from 'zod';
import type { DateTime } from 'luxon';
import { ValidationError, NotFoundError } from '@quantbot/utils';
import type {
  WorkflowContext,
  SimulationRunSpec,
  SimulationRunResult,
  SimulationCallResult,
} from '../types.js';
import { createProductionContext } from '../context/createProductionContext.js';

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
  ctx: WorkflowContext = createDefaultRunSimulationContext()
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

  const strategy = await ctx.repos.strategies.getByName(spec.strategyName);
  if (!strategy) {
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

  const results: SimulationCallResult[] = [];
  const pnlOk: number[] = [];
  let tradesTotal = 0;

  ctx.logger.info('[workflows.runSimulation] start', {
    runId,
    strategy: strategy.name,
    calls: uniqueCalls.length,
    dryRun,
  });

  for (const call of uniqueCalls) {
    const callISO = call.createdAt.toISO()!;
    try {
      // Workflow-controlled time window (conservative: window around call timestamp)
      const fromWindow = call.createdAt.minus({ minutes: preMin }).toISO()!;
      const toWindow = call.createdAt.plus({ minutes: postMin }).toISO()!;

      const candles = await ctx.ohlcv.getCandles({
        mint: call.mint,
        fromISO: fromWindow,
        toISO: toWindow,
      });

      if (candles.length === 0) {
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

      const sim = await ctx.simulation.run({ candles, strategy, call });

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
      ctx.logger.warn('[workflows.runSimulation] per-call error', {
        runId,
        callId: call.id,
        mint: call.mint,
        msg,
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

  ctx.logger.info('[workflows.runSimulation] done', {
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
