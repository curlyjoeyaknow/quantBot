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
import {
  upsertRunMetadata,
  persistPolicyResultsToCentral,
} from './reporting/central-duckdb-persistence.js';
import { planBacktest } from './plan.js';
import { checkCoverage } from './coverage.js';
import { materialiseSlice } from './slice.js';
import { loadCandlesFromSlice } from './runBacktest.js';
import { logger, TimingContext, type LogContext } from '@quantbot/utils';
import { DateTime } from 'luxon';

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
  const startedAt = new Date();
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

  // Persist run metadata to central DuckDB
  await upsertRunMetadata({
    run_id: runId,
    run_mode: 'policy',
    status: 'running',
    params_json: JSON.stringify({
      policyId: req.policyId,
      policy: req.policy,
      interval: req.interval,
      from: req.from.toISO(),
      to: req.to.toISO(),
      fees: simpleFees,
      executionModel: req.executionModel || 'simple',
    }),
    interval: req.interval,
    time_from: req.from.toJSDate(),
    time_to: req.to.toJSDate(),
    started_at: startedAt,
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

  // Step 6: Persist results
  await timing.phase('store', async () => {
    const artifactsDir = join(process.cwd(), 'artifacts', 'backtest', runId);
    await mkdir(artifactsDir, { recursive: true });

    const duckdbPath = req.existingDuckdbPath || join(artifactsDir, 'results.duckdb');
    const duckdb = await import('duckdb');
    const database = new duckdb.Database(duckdbPath);
    const db = database.connect();

    try {
      if (policyResults.length > 0) {
        const adapter = createDuckDbAdapter(db as DuckDbConnection);
        await insertPolicyResults(
          adapter as Parameters<typeof insertPolicyResults>[0],
          policyResults
        );
        logger.info('Policy results persisted', {
          rows: policyResults.length,
          duckdbPath,
        });

        // Also persist to central DuckDB for auditability
        await persistPolicyResultsToCentral(policyResults);
      }
    } finally {
      database.close();
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

  // Update run metadata in central DuckDB with completion status
  const finishedAt = new Date();
  const avgReturnBps = aggregateMetrics.avgReturnBps;
  await upsertRunMetadata({
    run_id: runId,
    run_mode: 'policy',
    status: 'completed',
    params_json: JSON.stringify({
      policyId: req.policyId,
      policy: req.policy,
      interval: req.interval,
      from: req.from.toISO(),
      to: req.to.toISO(),
      fees: simpleFees,
      executionModel: req.executionModel || 'simple',
    }),
    interval: req.interval,
    time_from: req.from.toJSDate(),
    time_to: req.to.toJSDate(),
    started_at: startedAt,
    finished_at: finishedAt,
    total_calls: coverage.eligible.length,
    total_trades: policyResults.length,
    avg_return_bps: avgReturnBps,
  });

  // Log the sacred timing line - when regressions happen, this screams
  logger.info(timing.summaryLine());
  logger.info('Policy backtest complete', summary as unknown as LogContext);

  return summary;
}

// =============================================================================
// Helpers
// =============================================================================

function createDuckDbAdapter(db: DuckDbConnection): DuckDbConnection {
  return {
    run(sql: string, params: any[], callback: (err: any) => void): void {
      db.run(sql, params, callback);
    },
    all<T = any>(sql: string, params: any[], callback: (err: any, rows: T[]) => void): void {
      (db.all as (sql: string, params: any[], cb: (err: any, rows: any) => void) => void)(
        sql,
        params,
        (err: any, rows: any) => {
          if (err) {
            callback(err, []);
          } else {
            callback(null, rows as T[]);
          }
        }
      );
    },
    prepare(sql: string, callback: (err: any, stmt: any) => void): void {
      db.prepare(sql, callback);
    },
  };
}
