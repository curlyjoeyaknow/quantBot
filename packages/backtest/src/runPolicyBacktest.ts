/**
 * Run Policy Backtest Workflow (Phase 4 - MVP 2)
 *
 * Executes a risk policy against calls with candle replay.
 * Stores results in backtest_policy_results table.
 *
 * Guardrail 3: Policy Execution Replays Candles
 * - Policy execution needs candle stream to know what would have triggered when
 * - Path metrics are for evaluation only (used for tail capture calculation)
 */

import { randomUUID } from 'crypto';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import { insertPolicyResults, type DuckDbConnection } from './reporting/backtest-results-duckdb.js';
import { planBacktest } from './plan.js';
import { checkCoverage } from './coverage.js';
import { materialiseSlice } from './slice.js';
import { loadCandlesFromSlice } from './runBacktest.js';

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
  fees?: {
    takerFeeBps: number;
    slippageBps: number;
  };
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

  logger.info('Starting policy backtest', {
    runId,
    policyId: req.policyId,
    policyKind: req.policy.kind,
    calls: req.calls.length,
  });

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
    };
  }

  logger.info('Coverage check complete', {
    eligible: coverage.eligible.length,
    excluded: coverage.excluded.length,
  });

  // Step 3: Slice materialisation

  // Create call lookup map
  const callsById = new Map(req.calls.map((call) => [call.id, call]));

  // Step 5: Execute policy for each eligible call

  logger.info('Policy execution complete', {
    results: policyResults.length,
    stopOuts: stopOutCount,
  });


  const summary: PolicyBacktestSummary = {
    runId,
    policyId: req.policyId,
    callsProcessed: coverage.eligible.length,
    callsExcluded: coverage.excluded.length,
    policyResultsWritten: policyResults.length,
  logger.info('Policy backtest complete', summary as unknown as LogContext);

  return summary;
}

// =============================================================================
// Helpers
// =============================================================================
