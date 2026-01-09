/**
 * Run Path-Only Backtest - Truth Layer Orchestrator
 *
 * Guardrail 2: Path-Only Mode
 * - First-class mode: --strategy path-only
 * - Flow: slices candles → computes path metrics → writes 1 row per call → stops
 * - No exit plans, no trades, no "continue if trades.length==0" footguns
 *
 * This is the TRUTH LAYER - the keel of the ship.
 * Everything else bolts onto it.
 *
 * Wall-clock timing per phase:
 * - plan: planning step
 * - coverage: coverage check
 * - slice: slice materialisation
 * - load: candle loading
 * - compute: path metrics computation
 * - store: DuckDB persistence
 *
 * When something regresses from 15s → 40s, the timing summary will scream.
 */

import { randomUUID } from 'crypto';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import type { PathOnlyRequest, PathOnlySummary, PathMetricsRow, BacktestPlan } from './types.js';
import { planBacktest } from './plan.js';
import { checkCoverage } from './coverage.js';
import { materialiseSlice } from './slice.js';
import { loadCandlesFromSlice } from './runBacktest.js';
import { computePathMetrics } from './metrics/path-metrics.js';
import { logger, TimingContext, type LogContext } from '@quantbot/utils';
import { createRunDirectory, getGitProvenance } from './artifacts/index.js';
import type { AlertArtifact, PathArtifact } from './artifacts/index.js';

/**
 * Run path-only backtest
 *
 * This is the TRUTH LAYER - computes and persists path metrics for EVERY eligible call.
 * No trades, no policy execution, no footguns.
 *
 * Flow:
 * 1. Plan: compute requirements per call (reuse existing)
 * 2. Coverage: verify data exists for calls (reuse existing)
 * 3. Slice: materialise candle dataset for calls (reuse existing)
 * 4. Load candles: from slice (reuse existing)
 * 5. Compute path metrics: for EVERY eligible call (reuse existing)
 * 6. Persist: to backtest_call_path_metrics table (new)
 * 7. Stop (no trades, no policy execution)
 */
export async function runPathOnly(req: PathOnlyRequest): Promise<PathOnlySummary> {
  const runId = randomUUID();
  const activityMovePct = req.activityMovePct ?? 0.1;

  // Wall-clock timing - when something regresses 15s → 40s, this screams
  const timing = new TimingContext();
  timing.start();

  logger.info('Starting path-only backtest', {
    runId,
    calls: req.calls.length,
    interval: req.interval,
  });

  // Initialize structured artifact directory
  const runDir = await createRunDirectory(runId, 'path-only');
  
  // Get git provenance
  const gitInfo = await getGitProvenance();
  runDir.updateManifest({
    git_commit: gitInfo.commit,
    git_branch: gitInfo.branch,
    git_dirty: gitInfo.dirty,
    dataset: {
      from: req.from?.toISOString(),
      to: req.to?.toISOString(),
      interval: req.interval,
      calls_count: req.calls.length,
    },
  });

  // Step 1: Plan (reuse existing)
  let plan: BacktestPlan;
  timing.phaseSync('plan', () => {
    // Create a minimal strategy for planning purposes (no overlays needed for path-only)
    const planReq = {
      strategy: {
        id: 'path-only',
        name: 'path-only',
        overlays: [],
        fees: { takerFeeBps: 0, slippageBps: 0 },
        position: { notionalUsd: 0 },
        indicatorWarmup: 0,
        entryDelay: 0,
        maxHold: 1440, // 24h default for path metrics window
      },
      calls: req.calls,
      interval: req.interval,
      from: req.from,
      to: req.to,
    };

    plan = planBacktest(planReq);
  });

  logger.info('Planning complete', {
    totalRequiredCandles: plan!.totalRequiredCandles,
    calls: req.calls.length,
  });

  // Step 2: Coverage gate (reuse existing)
  const coverage = await timing.phase('coverage', async () => {
    return checkCoverage(plan!);
  });

  if (coverage.eligible.length === 0) {
    timing.end();
    logger.warn('No eligible calls after coverage check', {
      runId,
      excluded: coverage.excluded.length,
    });

    return {
      runId,
      callsProcessed: 0,
      callsExcluded: coverage.excluded.length,
      pathMetricsWritten: 0,
      timing: timing.toJSON(),
    };
  }

  logger.info('Coverage check complete', {
    eligible: coverage.eligible.length,
    excluded: coverage.excluded.length,
  });

  // Step 3: Slice materialisation (reuse existing)
  const slice = await timing.phase('slice', async () => {
    return materialiseSlice(plan!, coverage);
  });

  logger.info('Slice materialised', {
    path: slice.path,
    calls: slice.callIds.length,
  });

  // Step 4: Load candles from slice (reuse existing)
  const candlesByCall = await timing.phase('load', async () => {
    return loadCandlesFromSlice(slice.path);
  });

  // Create call lookup map
  const callsById = new Map(req.calls.map((call) => [call.id, call]));

  // Step 5: Compute path metrics for EVERY eligible call
  const pathMetricsRows: PathMetricsRow[] = timing.phaseSync('compute', () => {
    const rows: PathMetricsRow[] = [];

    for (const eligible of coverage.eligible) {
      const call = callsById.get(eligible.callId);
      if (!call) {
        logger.warn('Call not found in lookup', { callId: eligible.callId });
        continue;
      }

      const candles = candlesByCall.get(eligible.callId) || [];

      if (candles.length === 0) {
        logger.warn('No candles found for call', { callId: eligible.callId });
        continue;
      }

      // Anchor time: ALERT timestamp (ms)
      const t0_ms = call.createdAt.toMillis();

      // Compute path metrics
      const path = computePathMetrics(candles, t0_ms, {
        activity_move_pct: activityMovePct,
      });

      // Skip if anchor price is invalid (no valid candles at/after alert)
      if (!isFinite(path.p0) || path.p0 <= 0) {
        logger.warn('Invalid anchor price for call', {
          callId: eligible.callId,
          p0: path.p0,
        });
        continue;
      }

      // Build path metrics row - ALWAYS written (Guardrail 2)
      rows.push({
        run_id: runId,
        call_id: eligible.callId,
        caller_name: call.caller,
        mint: call.mint,
        chain: eligible.chain,
        interval: req.interval,

        alert_ts_ms: t0_ms,
        p0: path.p0,

        hit_2x: path.hit_2x,
        t_2x_ms: path.t_2x_ms,
        hit_3x: path.hit_3x,
        t_3x_ms: path.t_3x_ms,
        hit_4x: path.hit_4x,
        t_4x_ms: path.t_4x_ms,

        dd_bps: path.dd_bps,
        dd_to_2x_bps: path.dd_to_2x_bps,
        alert_to_activity_ms: path.alert_to_activity_ms,
        peak_multiple: path.peak_multiple,
      });
    }

    return rows;
  });

  logger.info('Path metrics computed', {
    computed: pathMetricsRows.length,
    eligible: coverage.eligible.length,
  });

  // Step 6: Write structured artifacts
  await timing.phase('store', async () => {
    try {
      // Write alerts (inputs)
      const alertArtifacts: AlertArtifact[] = req.calls.map((call) => ({
        call_id: call.id,
        mint: call.mint,
        caller_name: call.caller,
        chain: 'solana', // TODO: derive from call data
        alert_ts_ms: call.createdAt.toMillis(),
        created_at: call.createdAt.toISO(),
      }));
      await runDir.writeArtifact('alerts', alertArtifacts as unknown as Array<Record<string, unknown>>);

      // Write paths (truth layer)
      if (pathMetricsRows.length > 0) {
        const pathArtifacts: PathArtifact[] = pathMetricsRows.map((row) => ({
          run_id: row.run_id,
          call_id: row.call_id,
          caller_name: row.caller_name,
          mint: row.mint,
          chain: row.chain,
          interval: row.interval,
          alert_ts_ms: row.alert_ts_ms,
          p0: row.p0,
          hit_2x: row.hit_2x,
          t_2x_ms: row.t_2x_ms,
          hit_3x: row.hit_3x,
          t_3x_ms: row.t_3x_ms,
          hit_4x: row.hit_4x,
          t_4x_ms: row.t_4x_ms,
          dd_bps: row.dd_bps,
          dd_to_2x_bps: row.dd_to_2x_bps,
          alert_to_activity_ms: row.alert_to_activity_ms,
          peak_multiple: row.peak_multiple,
        }));
        await runDir.writeArtifact('paths', pathArtifacts as unknown as Array<Record<string, unknown>>);
      }

      // Update timing in manifest
      runDir.updateManifest({
        timing: {
          plan_ms: timing.phases.plan?.durationMs,
          coverage_ms: timing.phases.coverage?.durationMs,
          slice_ms: timing.phases.slice?.durationMs,
          execution_ms: (timing.phases.load?.durationMs ?? 0) + (timing.phases.compute?.durationMs ?? 0),
          total_ms: timing.totalMs,
        },
      });

      // Mark as successful
      await runDir.markSuccess();

      logger.info('Artifacts written', {
        runId,
        runDir: runDir.getRunDir(),
        alerts: alertArtifacts.length,
        paths: pathMetricsRows.length,
      });
    } catch (error) {
      await runDir.markFailure(error as Error);
      throw error;
    }
  });

  // Step 7: Stop (no trades, no policy execution)
  // That's it! Path-only mode is complete.
  timing.end();

  const summary: PathOnlySummary = {
    runId,
    callsProcessed: coverage.eligible.length,
    callsExcluded: coverage.excluded.length,
    pathMetricsWritten: pathMetricsRows.length,
    timing: timing.toJSON(),
  };

  // Log the sacred timing line - when regressions happen, this screams
  logger.info(timing.summaryLine());
  logger.info('Path-only backtest complete', summary as unknown as LogContext);

  return summary;
}
