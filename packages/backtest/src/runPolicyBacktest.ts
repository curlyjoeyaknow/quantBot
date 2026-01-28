/**
 * Run Policy Backtest Workflow (Phase 4 - MVP 2)
 *
 * Executes a risk policy against calls with candle replay.
 * Stores results in backtest_policy_results table.
 *
 * Guardrail 3: Policy Execution Replays Candles
 * - Policy execution needs candle stream to know what would have triggered when
 * - Path metrics are for evaluation only (used for tail capture calculation)
 *
 * Wall-clock timing per phase:
 * - plan: planning step
 * - coverage: coverage check
 * - slice: slice materialisation
 * - load: candle loading
 * - execute: policy execution
 * - aggregate: metrics aggregation
 * - store: DuckDB persistence
 */

import { randomUUID } from 'crypto';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import type { CallRecord, Interval, PolicyResultRow, TimingSummary } from './types.js';
import type { RiskPolicy } from './policies/risk-policy.js';
import { executePolicy, type FeeConfig, type ExecutionConfig } from './policies/policy-executor.js';
import { createExecutionConfig, type ExecutionModelVenue } from './execution/index.js';
import { insertPolicyResults, type DuckDbConnection } from './reporting/backtest-results-duckdb.js';
import { planBacktest } from './plan.js';
import { checkCoverage } from './coverage.js';
import { materialiseSlice } from './slice.js';
import { loadCandlesFromSlice } from './runBacktest.js';
import { logger, TimingContext, type LogContext } from '@quantbot/infra/utils';
import { DateTime } from 'luxon';
import { createRunDirectory, getGitProvenance } from './artifacts/index.js';
import type { AlertArtifact, TradeArtifact, SummaryArtifact } from './artifacts/index.js';
import { getEventEmitter } from './events/event-emitter.js';

// =============================================================================
// Types
// =============================================================================

export interface PolicyBacktestRequest {
  /** Policy to execute */
  policy: RiskPolicy;
  /** Unique policy ID for results storage */
  policyId: string;
  /** Calls to execute policy against */
  calls: CallRecord[];
  /** Candle interval */
  interval: Interval;
  /** Date range */
  from: DateTime;
  to: DateTime;
  /** Fee structure (simple model) */
  fees?: {
    takerFeeBps: number;
    slippageBps: number;
  };
  /**
   * Execution model venue (pumpfun, pumpswap, raydium, minimal, simple).
   * When set to a venue other than 'simple', uses realistic slippage/latency models.
   * Falls back to simple fees if not specified.
   */
  executionModel?: ExecutionModelVenue;
  /** Optional existing run ID (if re-using path metrics run) */
  runId?: string;
  /** Path to existing DuckDB with path metrics (optional) */
  existingDuckdbPath?: string;
}

export interface PolicyBacktestSummary {
  runId: string;
  policyId: string;
  callsProcessed: number;
  callsExcluded: number;
  policyResultsWritten: number;
  /** Aggregate metrics */
  metrics: {
    avgReturnBps: number;
    medianReturnBps: number;
    stopOutRate: number;
    avgTimeExposedMs: number;
    avgTailCapture: number | null;
    avgMaxAdverseExcursionBps: number;
  };
  /** Wall-clock timing breakdown by phase (optional for backwards compat) */
  timing?: TimingSummary;
}

// =============================================================================
// Main Workflow
// =============================================================================

/**
 * Run policy backtest
 *
 * Executes a risk policy against calls by replaying candles.
 * Stores results in backtest_policy_results table.
 */
export async function runPolicyBacktest(
  req: PolicyBacktestRequest
): Promise<PolicyBacktestSummary> {
  const runId = req.runId || randomUUID();
  const simpleFees: FeeConfig = req.fees || { takerFeeBps: 30, slippageBps: 10 };
  const eventEmitter = getEventEmitter();

  // Create execution config from venue or simple fees
  const executionConfig: ExecutionConfig = createExecutionConfig(
    req.executionModel || 'simple',
    simpleFees
  );

  // Wall-clock timing - when something regresses 15s → 40s, this screams
  const timing = new TimingContext();
  timing.start();

  logger.info('Starting policy backtest', {
    runId,
    policyId: req.policyId,
    policyKind: req.policy.kind,
    calls: req.calls.length,
  });

  // Emit run.created event
  const config = {
    policyId: req.policyId,
    policyKind: req.policy.kind,
    executionModel: req.executionModel || 'simple',
    interval: req.interval,
    from: req.from?.toISO() || undefined,
    to: req.to?.toISO() || undefined,
    callsCount: req.calls.length,
    fees: simpleFees,
  };
  const dataFingerprint = `${req.policyId}_${req.interval}_${req.from?.toISO() || 'none'}_${req.to?.toISO() || 'none'}_${req.calls.length}`;
  await eventEmitter.emitRunCreated(runId, 'policy', config, dataFingerprint);

  // Emit run.started event
  await eventEmitter.emitRunStarted(runId);

  // Mandatory deduplication: dedup by call id, keep earliest instance
  const callsById = new Map<string, (typeof req.calls)[number]>();
  for (const call of req.calls) {
    if (!callsById.has(call.id)) {
      callsById.set(call.id, call);
    }
  }
  const uniqueCalls = [...callsById.values()].sort(
    (a, b) => a.createdAt.toMillis() - b.createdAt.toMillis()
  );

  if (uniqueCalls.length < req.calls.length) {
    const duplicatesRemoved = req.calls.length - uniqueCalls.length;
    logger.warn('Deduplicated calls', {
      originalCount: req.calls.length,
      uniqueCount: uniqueCalls.length,
      duplicatesRemoved,
    });
  }

  // Initialize structured artifact directory
  const runDir = await createRunDirectory(runId, 'policy');

  // Get git provenance
  const gitInfo = await getGitProvenance();
  runDir.updateManifest({
    git_commit: gitInfo.commit,
    git_branch: gitInfo.branch,
    git_dirty: gitInfo.dirty,
    dataset: {
      from: req.from?.toISO() || undefined,
      to: req.to?.toISO() || undefined,
      interval: req.interval,
      calls_count: uniqueCalls.length,
    },
    parameters: {
      policy_id: req.policyId,
      policy_kind: req.policy.kind,
      execution_model: req.executionModel || 'simple',
    },
  });

  // Step 1: Plan (reuse existing)
  let phaseOrder = 0;
  await eventEmitter.emitPhaseStarted(runId, 'plan', phaseOrder++);
  const planStartTime = Date.now();
  const plan = timing.phaseSync('plan', () => {
    const planReq = {
      strategy: {
        id: 'policy-backtest',
        name: 'policy-backtest',
        overlays: [],
        fees: simpleFees, // Use simple fees for planning
        position: { notionalUsd: 1000 },
        indicatorWarmup: 0,
        entryDelay: 0,
        maxHold: 1440, // 24h window
      },
      calls: uniqueCalls,
      interval: req.interval,
      from: req.from,
      to: req.to,
    };
    return planBacktest(planReq);
  });
  const planDurationMs = Date.now() - planStartTime;
  await eventEmitter.emitPhaseCompleted(runId, 'plan', planDurationMs, {
    calls: uniqueCalls.length,
  });
  logger.info('Planning complete', { calls: uniqueCalls.length });

  // Step 2: Coverage gate
  await eventEmitter.emitPhaseStarted(runId, 'coverage', phaseOrder++);
  const coverageStartTime = Date.now();
  const coverage = await timing.phase('coverage', async () => {
    return checkCoverage(plan);
  });
  const coverageDurationMs = Date.now() - coverageStartTime;
  await eventEmitter.emitPhaseCompleted(runId, 'coverage', coverageDurationMs, {
    eligible: coverage.eligible.length,
    excluded: coverage.excluded.length,
  });

  if (coverage.eligible.length === 0) {
    timing.end();
    logger.warn('No eligible calls after coverage check', {
      runId,
      excluded: coverage.excluded.length,
    });

    return {
      runId,
      policyId: req.policyId,
      callsProcessed: 0,
      callsExcluded: coverage.excluded.length,
      policyResultsWritten: 0,
      metrics: {
        avgReturnBps: 0,
        medianReturnBps: 0,
        stopOutRate: 0,
        avgTimeExposedMs: 0,
        avgTailCapture: null,
        avgMaxAdverseExcursionBps: 0,
      },
      timing: timing.toJSON(),
    };
  }

  logger.info('Coverage check complete', {
    eligible: coverage.eligible.length,
    excluded: coverage.excluded.length,
  });

  // Step 3: Slice materialisation
  await eventEmitter.emitPhaseStarted(runId, 'slice', phaseOrder++);
  const sliceStartTime = Date.now();
  const slice = await timing.phase('slice', async () => {
    return materialiseSlice(plan, coverage);
  });
  const sliceDurationMs = Date.now() - sliceStartTime;
  await eventEmitter.emitPhaseCompleted(runId, 'slice', sliceDurationMs, {
    path: slice.path,
  });
  logger.info('Slice materialised', { path: slice.path });

  // Step 4: Load candles
  await eventEmitter.emitPhaseStarted(runId, 'load', phaseOrder++);
  const loadStartTime = Date.now();
  const candlesByCall = await timing.phase('load', async () => {
    return loadCandlesFromSlice(slice.path);
  });
  const loadDurationMs = Date.now() - loadStartTime;
  await eventEmitter.emitPhaseCompleted(runId, 'load', loadDurationMs, {
    callsLoaded: candlesByCall.size,
  });

  // Reuse callsById map from deduplication step above

  // Step 5: Execute policy for each eligible call
  await eventEmitter.emitPhaseStarted(runId, 'execute', phaseOrder++);
  const executeStartTime = Date.now();
  const executionResult = timing.phaseSync('execute', () => {
    const policyResults: PolicyResultRow[] = [];
    const returnsBps: number[] = [];
    const tailCaptures: number[] = [];
    let stopOutCount = 0;
    let totalTimeExposedMs = 0;
    let totalMaxAdverseExcursionBps = 0;

    for (const eligible of coverage.eligible) {
      const call = callsById.get(eligible.callId);
      if (!call) continue;

      const candles = candlesByCall.get(eligible.callId) || [];
      if (candles.length === 0) continue;

      // Alert timestamp in ms
      const alertTsMs = call.createdAt.toMillis();

      // Execute policy (Guardrail 3: replay candles)
      // Uses execution config which may include venue-specific slippage model
      const result = executePolicy(candles, alertTsMs, req.policy, executionConfig);

      // Skip if no entry
      if (result.exitReason === 'no_entry') continue;

      // Build policy result row
      policyResults.push({
        run_id: runId,
        policy_id: req.policyId,
        call_id: eligible.callId,
        realized_return_bps: result.realizedReturnBps,
        stop_out: result.stopOut,
        max_adverse_excursion_bps: result.maxAdverseExcursionBps,
        time_exposed_ms: result.timeExposedMs,
        tail_capture: result.tailCapture,
        entry_ts_ms: result.entryTsMs,
        exit_ts_ms: result.exitTsMs,
        entry_px: result.entryPx,
        exit_px: result.exitPx,
        exit_reason: result.exitReason,
      });

      // Aggregate metrics
      returnsBps.push(result.realizedReturnBps);
      if (result.stopOut) stopOutCount++;
      totalTimeExposedMs += result.timeExposedMs;
      totalMaxAdverseExcursionBps += result.maxAdverseExcursionBps;
      if (result.tailCapture !== null) {
        tailCaptures.push(result.tailCapture);
      }
    }

    return {
      policyResults,
      returnsBps,
      tailCaptures,
      stopOutCount,
      totalTimeExposedMs,
      totalMaxAdverseExcursionBps,
    };
  });
  const executeDurationMs = Date.now() - executeStartTime;
  await eventEmitter.emitPhaseCompleted(runId, 'execute', executeDurationMs, {
    results: executionResult.policyResults.length,
    stopOuts: executionResult.stopOutCount,
  });

  const {
    policyResults,
    returnsBps,
    tailCaptures,
    stopOutCount,
    totalTimeExposedMs,
    totalMaxAdverseExcursionBps,
  } = executionResult;

  logger.info('Policy execution complete', {
    results: policyResults.length,
    stopOuts: stopOutCount,
  });

  // Step 6: Write structured artifacts
  await eventEmitter.emitPhaseStarted(runId, 'store', phaseOrder++);
  const storeStartTime = Date.now();
  const artifactPaths: Record<string, string> = {};
  await timing.phase('store', async () => {
    try {
      // Write alerts (inputs)
      const alertArtifacts: AlertArtifact[] = uniqueCalls.map((call) => ({
        call_id: call.id,
        mint: call.mint as string,
        caller_name: call.caller,
        chain: 'solana',
        alert_ts_ms: call.createdAt.toMillis(),
        created_at: call.createdAt.toISO() || '',
      }));
      await runDir.writeArtifact(
        'alerts',
        alertArtifacts as unknown as Array<Record<string, unknown>>
      );

      // Write trades (policy simulation)
      if (policyResults.length > 0) {
        const tradeArtifacts: TradeArtifact[] = policyResults.map((row) => ({
          run_id: row.run_id,
          policy_id: row.policy_id,
          call_id: row.call_id,
          entry_ts_ms: row.entry_ts_ms,
          entry_px: row.entry_px,
          exit_ts_ms: row.exit_ts_ms,
          exit_px: row.exit_px,
          pnl_pct: row.realized_return_bps / 10000, // Convert bps to percentage
          exit_reason: row.exit_reason,
          realized_return_bps: row.realized_return_bps,
          stop_out: row.stop_out,
          max_adverse_excursion_bps: row.max_adverse_excursion_bps,
          time_exposed_ms: row.time_exposed_ms,
          tail_capture: row.tail_capture,
        }));
        await runDir.writeArtifact(
          'trades',
          tradeArtifacts as unknown as Array<Record<string, unknown>>
        );
      }

      // Collect artifact paths for event emission
      artifactPaths['run_dir'] = runDir.getRunDir();
      artifactPaths['alerts'] = join(runDir.getRunDir(), 'alerts.parquet');
      if (policyResults.length > 0) {
        artifactPaths['trades'] = join(runDir.getRunDir(), 'trades.parquet');
      }

      logger.info('Artifacts written', {
        runId,
        runDir: runDir.getRunDir(),
        alerts: alertArtifacts.length,
        trades: policyResults.length,
      });
    } catch (error) {
      await runDir.markFailure(error as Error);
      throw error;
    }
  });
  const storeDurationMs = Date.now() - storeStartTime;
  await eventEmitter.emitPhaseCompleted(runId, 'store', storeDurationMs, {
    artifactPaths,
  });

  // Step 7: Calculate aggregate metrics
  await eventEmitter.emitPhaseStarted(runId, 'aggregate', phaseOrder++);
  const aggregateStartTime = Date.now();
  const aggregateMetrics = timing.phaseSync('aggregate', () => {
    const avgReturnBps =
      returnsBps.length > 0 ? returnsBps.reduce((a, b) => a + b, 0) / returnsBps.length : 0;

    const sortedReturns = [...returnsBps].sort((a, b) => a - b);
    const medianReturnBps =
      sortedReturns.length > 0 ? sortedReturns[Math.floor(sortedReturns.length / 2)] : 0;

    const stopOutRate = policyResults.length > 0 ? stopOutCount / policyResults.length : 0;

    const avgTimeExposedMs =
      policyResults.length > 0 ? totalTimeExposedMs / policyResults.length : 0;

    const avgTailCapture =
      tailCaptures.length > 0
        ? tailCaptures.reduce((a, b) => a + b, 0) / tailCaptures.length
        : null;

    const avgMaxAdverseExcursionBps =
      policyResults.length > 0 ? totalMaxAdverseExcursionBps / policyResults.length : 0;

    return {
      avgReturnBps,
      medianReturnBps,
      stopOutRate,
      avgTimeExposedMs,
      avgTailCapture,
      avgMaxAdverseExcursionBps,
    };
  });
  const aggregateDurationMs = Date.now() - aggregateStartTime;
  await eventEmitter.emitPhaseCompleted(runId, 'aggregate', aggregateDurationMs, aggregateMetrics);

  // Step 8: Write summary artifact
  const summaryArtifact: SummaryArtifact = {
    run_id: runId,
    run_type: 'policy',
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    calls_processed: coverage.eligible.length,
    calls_excluded: coverage.excluded.length,
    trades_count: policyResults.length,
    avg_return_bps: aggregateMetrics.avgReturnBps,
    median_return_bps: aggregateMetrics.medianReturnBps,
    stop_out_rate: aggregateMetrics.stopOutRate,
    avg_max_adverse_excursion_bps: aggregateMetrics.avgMaxAdverseExcursionBps,
    avg_time_exposed_ms: aggregateMetrics.avgTimeExposedMs,
    avg_tail_capture: aggregateMetrics.avgTailCapture,
    median_tail_capture: null, // TODO: calculate if needed
  };
  await runDir.writeArtifact('summary', [summaryArtifact] as unknown as Array<
    Record<string, unknown>
  >);

  // Update timing in manifest and mark success
  const timingParts = timing.parts;
  runDir.updateManifest({
    timing: {
      plan_ms: timingParts.plan,
      coverage_ms: timingParts.coverage,
      slice_ms: timingParts.slice,
      execution_ms: (timingParts.load ?? 0) + (timingParts.execute ?? 0),
      total_ms: timing.totalMs,
    },
  });
  await runDir.markSuccess();

  timing.end();

  const summary: PolicyBacktestSummary = {
    runId,
    policyId: req.policyId,
    callsProcessed: coverage.eligible.length,
    callsExcluded: coverage.excluded.length,
    policyResultsWritten: policyResults.length,
    metrics: aggregateMetrics,
    timing: timing.toJSON(),
  };

  // Emit run.completed event
  await eventEmitter.emitRunCompleted(
    runId,
    summary as unknown as Record<string, unknown>,
    artifactPaths
  );

  // Log the sacred timing line - when regressions happen, this screams
  logger.info(timing.summaryLine());
  logger.info('Policy backtest complete', summary as unknown as LogContext);

  return summary;
}

// =============================================================================
// Helpers
// =============================================================================
