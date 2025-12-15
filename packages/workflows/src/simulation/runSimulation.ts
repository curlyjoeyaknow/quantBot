import pLimit from 'p-limit';
import { DateTime } from 'luxon';
import {
  SimulationRunSpec,
  SimulationRunSpecSchema,
  SimulationRunResult,
  WorkflowContext,
  WorkflowError,
} from '../types';

function err(code: string, message: string, details?: Record<string, unknown>): WorkflowError {
  return { code, message, details };
}

function safeError(e: unknown): { message: string; details?: Record<string, unknown> } {
  if (e instanceof Error) return { message: e.message };
  return { message: String(e) };
}

function median(nums: number[]): number | undefined {
  if (nums.length === 0) return undefined;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export async function runSimulation(
  specInput: SimulationRunSpec,
  ctx: WorkflowContext
): Promise<SimulationRunResult> {
  const parsed = SimulationRunSpecSchema.safeParse(specInput);
  if (!parsed.success) {
    return {
      runId: 'INVALID_SPEC',
      strategyName: specInput.strategyName ?? 'UNKNOWN',
      callerName: specInput.callerName,
      from: specInput.from ?? '',
      to: specInput.to ?? '',
      interval: (specInput.interval ?? '1m') as any,
      totals: { targets: 0, ok: 0, failed: 1 },
      summary: {},
      results: [],
      errors: [
        err('INVALID_SPEC', 'SimulationRunSpec validation failed', { issues: parsed.error.issues }),
      ],
    };
  }

  const spec = parsed.data;

  const fromDt = DateTime.fromISO(spec.from);
  const toDt = DateTime.fromISO(spec.to);
  if (!fromDt.isValid || !toDt.isValid) {
    return {
      runId: 'INVALID_DATES',
      strategyName: spec.strategyName,
      callerName: spec.callerName,
      from: spec.from,
      to: spec.to,
      interval: spec.interval,
      totals: { targets: 0, ok: 0, failed: 1 },
      summary: {},
      results: [],
      errors: [err('INVALID_DATES', 'from/to must be valid ISO datetimes')],
    };
  }
  if (toDt <= fromDt) {
    return {
      runId: 'INVALID_RANGE',
      strategyName: spec.strategyName,
      callerName: spec.callerName,
      from: spec.from,
      to: spec.to,
      interval: spec.interval,
      totals: { targets: 0, ok: 0, failed: 1 },
      summary: {},
      results: [],
      errors: [err('INVALID_RANGE', '`to` must be after `from`')],
    };
  }

  ctx.logger.info('workflows.runSimulation:start', {
    strategyName: spec.strategyName,
    callerName: spec.callerName,
    from: spec.from,
    to: spec.to,
    interval: spec.interval,
    dryRun: spec.dryRun,
    concurrency: spec.concurrency,
  });

  const strategy = await ctx.repos.strategies.getByName(spec.strategyName);
  if (!strategy) {
    return {
      runId: 'STRATEGY_NOT_FOUND',
      strategyName: spec.strategyName,
      callerName: spec.callerName,
      from: spec.from,
      to: spec.to,
      interval: spec.interval,
      totals: { targets: 0, ok: 0, failed: 1 },
      summary: {},
      results: [],
      errors: [err('STRATEGY_NOT_FOUND', `Strategy not found: ${spec.strategyName}`)],
    };
  }

  const calls = await ctx.repos.calls.listByRange({
    callerName: spec.callerName,
    fromIso: spec.from,
    toIso: spec.to,
  });

  const runId = spec.dryRun
    ? `dryrun_${Date.now()}`
    : await ctx.repos.runs.createRun({
        strategyName: spec.strategyName,
        callerName: spec.callerName,
        fromIso: spec.from,
        toIso: spec.to,
        interval: spec.interval,
        dryRun: spec.dryRun,
      });

  if (calls.length === 0) {
    ctx.logger.warn('workflows.runSimulation:no_calls', { runId });
    return {
      runId,
      strategyName: spec.strategyName,
      callerName: spec.callerName,
      from: spec.from,
      to: spec.to,
      interval: spec.interval,
      totals: { targets: 0, ok: 0, failed: 0 },
      summary: {},
      results: [],
      errors: [],
    };
  }

  const limit = pLimit(spec.concurrency);

  const results = await Promise.all(
    calls.map((call) =>
      limit(async () => {
        const mint = call.mint;
        const callId = call.id;

        try {
          const candles = await ctx.ohlcv.fetchHybridCandles({
            mint,
            fromIso: spec.from,
            toIso: spec.to,
            interval: spec.interval,
            preWindowMinutes: spec.preWindowMinutes,
            postWindowMinutes: spec.postWindowMinutes,
          });

          const simOut = await ctx.simulation.simulateOnCandles({
            strategyName: spec.strategyName,
            strategyConfig: strategy.config,
            candles,
            mint,
            callId,
          });

          if (!spec.dryRun) {
            await ctx.repos.results.upsertResult({
              runId,
              callId,
              mint,
              pnlMultiple: simOut.pnlMultiple,
              exitReason: simOut.exitReason,
              raw: simOut.raw,
            });
          }

          return {
            mint,
            callId,
            ok: true,
            pnlMultiple: simOut.pnlMultiple,
            exitReason: simOut.exitReason,
          } as const;
        } catch (e) {
          const se = safeError(e);
          ctx.logger.error('workflows.runSimulation:target_failed', {
            runId,
            mint,
            callId,
            error: se.message,
          });
          return {
            mint,
            callId,
            ok: false,
            errors: [err('TARGET_FAILED', se.message)],
          } as const;
        }
      })
    )
  );

  const okPnls = results
    .filter((r) => r.ok && typeof r.pnlMultiple === 'number')
    .map((r) => r.pnlMultiple as number);
  const avg = okPnls.length ? okPnls.reduce((a, b) => a + b, 0) / okPnls.length : undefined;
  const med = median(okPnls);
  const winRate = okPnls.length ? okPnls.filter((m) => m > 1.0).length / okPnls.length : undefined;

  const okCount = results.filter((r) => r.ok).length;
  const failedCount = results.length - okCount;

  ctx.logger.info('workflows.runSimulation:done', {
    runId,
    targets: results.length,
    ok: okCount,
    failed: failedCount,
  });

  return {
    runId,
    strategyName: spec.strategyName,
    callerName: spec.callerName,
    from: spec.from,
    to: spec.to,
    interval: spec.interval,
    totals: { targets: results.length, ok: okCount, failed: failedCount },
    summary: { avgPnlMultiple: avg, medianPnlMultiple: med, winRate },
    results: results.map((r) => ({
      mint: r.mint,
      callId: r.callId,
      ok: r.ok,
      pnlMultiple: (r as any).pnlMultiple,
      exitReason: (r as any).exitReason,
      errors: (r as any).errors,
    })),
    errors: [],
  };
}
