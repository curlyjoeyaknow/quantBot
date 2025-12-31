import { DateTime } from 'luxon';
import { randomUUID } from 'crypto';
import type { CommandContext } from '../../core/command-context.js';
import { type RunSimulationArgs } from '../../command-defs/simulation.js';
import { runSimulation, createProductionContext } from '@quantbot/workflows';
import type { SimulationRunSpec, WorkflowContext } from '@quantbot/workflows';
import type { Run } from '@quantbot/core';

/**
 * Convert interval string to seconds
 */
function intervalToSeconds(interval: string): number {
  const map: Record<string, number> = {
    '1m': 60,
    '5m': 300,
    '15m': 900,
    '1h': 3600,
  };
  return map[interval] || 300; // Default to 5m
}

export async function runSimulationHandler(args: RunSimulationArgs, ctx: CommandContext) {
  await ctx.ensureInitialized();
  const runRepo = ctx.services.runRepository();

  // Generate runId upfront so we can track it from the start
  const runId = randomUUID();

  // Build workflow spec
  const spec: SimulationRunSpec = {
    strategyName: args.strategy,
    callerName: args.caller,
    from: DateTime.fromISO(args.from, { zone: 'utc' }),
    to: DateTime.fromISO(args.to, { zone: 'utc' }),
    options: {
      preWindowMinutes: args.preWindow,
      postWindowMinutes: args.postWindow,
      dryRun: args.dryRun,
    },
  };

  // Create run record immediately (status = 'running')
  const run: Run = {
    run_id: runId,
    created_at: DateTime.utc(),
    strategy_id: args.strategy,
    params_json: JSON.stringify({
      strategy: args.strategy,
      caller: args.caller,
      from: args.from,
      to: args.to,
      interval: args.interval,
      preWindow: args.preWindow,
      postWindow: args.postWindow,
      dryRun: args.dryRun,
      concurrency: args.concurrency,
    }),
    interval_sec: intervalToSeconds(args.interval),
    time_from: spec.from,
    time_to: spec.to,
    universe_ref: args.caller ? `caller:${args.caller}` : undefined,
  };

  await runRepo.createRun(run);

  // Create production context with our runId
  const baseCtx = createProductionContext();
  const workflowCtx: WorkflowContext = {
    ...baseCtx,
    ids: {
      newRunId: () => runId, // Override to use our runId
    },
  };

  // Run workflow
  let result;
  try {
    result = await runSimulation(spec, workflowCtx);

    // Extract metrics from result
    const pnlMean = result.pnl.mean ?? 0;
    const pnlQuote = pnlMean * 1000; // Approximate: assume $1000 initial capital
    const maxDrawdown = result.pnl.min ? Math.abs(result.pnl.min) * 1000 : 0;
    const winRate =
      result.totals.callsSucceeded > 0
        ? result.totals.callsSucceeded / result.totals.callsAttempted
        : 0;

    // Insert metrics
    await runRepo.insertMetrics(runId, {
      roi: pnlMean, // Already a multiplier (e.g., 1.12 = +12%)
      pnl_quote: pnlQuote,
      max_drawdown: maxDrawdown,
      trades: result.totals.tradesTotal,
      win_rate: winRate,
      avg_hold_sec: 0, // Not available from workflow result
      fees_paid_quote: 0, // Not available from workflow result
      slippage_paid_quote: 0, // Not available from workflow result
    });

    // Mark as success
    await runRepo.finishRun(runId, 'success', new Date());

    return result;
  } catch (error) {
    // Mark as failed
    try {
      await runRepo.finishRun(runId, 'failed', new Date());
    } catch (repoError) {
      // Log but don't fail on repository error
      console.error('Failed to mark run as failed:', repoError);
    }
    throw error;
  }
}
