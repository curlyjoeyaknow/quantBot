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
import { logger, TimingContext, type LogContext } from '@quantbot/utils';
import { DateTime } from 'luxon';
import { createRunDirectory, getGitProvenance } from './artifacts/index.js';
import type { AlertArtifact, TradeArtifact, SummaryArtifact } from './artifacts/index.js';

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

  // Initialize structured artifact directory
  const runDir = await createRunDirectory(runId, 'policy');
  
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
    parameters: {
      policy_id: req.policyId,
      policy_kind: req.policy.kind,
      execution_model: req.executionModel || 'simple',
    },
  });

  // Step 1: Plan (reuse existing)
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
      calls: req.calls,
      interval: req.interval,
      from: req.from,
      to: req.to,
    };
    return planBacktest(planReq);
  });
  logger.info('Planning complete', { calls: req.calls.length });

  // Step 2: Coverage gate
  const coverage = await timing.phase('coverage', async () => {
    return checkCoverage(plan);
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
  const slice = await timing.phase('slice', async () => {
    return materialiseSlice(plan, coverage);
  });
  logger.info('Slice materialised', { path: slice.path });

  // Step 4: Load candles
  const candlesByCall = await timing.phase('load', async () => {
    return loadCandlesFromSlice(slice.path);
  });

  // Create call lookup map
  const callsById = new Map(req.calls.map((call) => [call.id, call]));

  // Step 5: Execute policy for each eligible call
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
  await timing.phase('store', async () => {
    try {
      // Write alerts (inputs)
      const alertArtifacts: AlertArtifact[] = req.calls.map((call) => ({
        call_id: call.id,
        mint: call.mint,
        caller_name: call.caller,
        chain: 'solana',
        alert_ts_ms: call.createdAt.toMillis(),
        created_at: call.createdAt.toISO(),
      }));
      await runDir.writeArtifact('alerts', alertArtifacts as unknown as Array<Record<string, unknown>>);

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
          exit_reason: row.exit_reason,
          realized_return_bps: row.realized_return_bps,
          stop_out: row.stop_out,
          max_adverse_excursion_bps: row.max_adverse_excursion_bps,
          time_exposed_ms: row.time_exposed_ms,
          tail_capture: row.tail_capture,
        }));
        await runDir.writeArtifact('trades', tradeArtifacts as unknown as Array<Record<string, unknown>>);
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

  // Step 7: Calculate aggregate metrics
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

  // Step 8: Write summary artifact
  const summaryArtifact: SummaryArtifact = {
    run_id: runId,
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
  await runDir.writeArtifact('summary', [summaryArtifact] as unknown as Array<Record<string, unknown>>);

  // Update timing in manifest and mark success
  runDir.updateManifest({
    timing: {
      plan_ms: timing.phases.plan?.durationMs,
      coverage_ms: timing.phases.coverage?.durationMs,
      slice_ms: timing.phases.slice?.durationMs,
      execution_ms: (timing.phases.load?.durationMs ?? 0) + (timing.phases.execute?.durationMs ?? 0),
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

  // Log the sacred timing line - when regressions happen, this screams
  logger.info(timing.summaryLine());
  logger.info('Policy backtest complete', summary as unknown as LogContext);

  return summary;
}

// =============================================================================
// Helpers
// =============================================================================
