/**
 * Frontier Writer
 *
 * Writes optimization frontier to artifacts.
 */

import type { RunDirectory } from '../artifacts/writer.js';
import type { FrontierArtifact } from '../artifacts/types.js';
import type { OptimizationResult } from './policy-optimizer.js';
import type { V1BaselineOptimizationResult, V1BaselinePerCallerResult } from './v1-baseline-optimizer.js';
import { policyToId } from './policy-optimizer.js';
import { logger } from '@quantbot/utils';

/**
 * Write policy optimization frontier to artifacts
 */
export async function writePolicyFrontier(
  runDir: RunDirectory,
  runId: string,
  callerName: string,
  result: OptimizationResult
): Promise<void> {
  if (result.allPolicies.length === 0) {
    logger.debug('No policies to write to frontier', { runId, callerName });
    return;
  }

  const frontierArtifacts: FrontierArtifact[] = result.allPolicies.map((p, index) => ({
    run_id: runId,
    caller_name: callerName,
    policy_params: JSON.stringify(p.policy),
    meets_constraints: p.score.satisfiesConstraints,
    objective_score: p.score.score,
    avg_return_bps: p.score.metrics.avgReturnBps,
    median_return_bps: p.score.metrics.medianReturnBps,
    stop_out_rate: p.score.metrics.stopOutRate,
    rank: index + 1,
  }));

  await runDir.writeArtifact('frontier', frontierArtifacts as unknown as Array<Record<string, unknown>>);

  logger.info('Wrote policy frontier', {
    runId,
    callerName,
    policies: frontierArtifacts.length,
    feasible: frontierArtifacts.filter((p) => p.meets_constraints).length,
  });
}

/**
 * Write V1 baseline optimization frontier to artifacts
 */
export async function writeV1BaselineFrontier(
  runDir: RunDirectory,
  runId: string,
  callerName: string,
  result: V1BaselineOptimizationResult
): Promise<void> {
  if (result.allParams.length === 0) {
    logger.debug('No parameters to write to frontier', { runId, callerName });
    return;
  }

  const frontierArtifacts: FrontierArtifact[] = result.allParams.map((p, index) => ({
    run_id: runId,
    caller_name: callerName,
    policy_params: JSON.stringify({
      tp_mult: p.params.tp_mult,
      sl_mult: p.params.sl_mult,
      max_hold_hrs: p.params.max_hold_hrs,
    }),
    meets_constraints: p.meetsConstraints,
    objective_score: p.score,
    avg_return_bps: p.metrics.avgReturnBps,
    median_return_bps: p.metrics.medianReturnBps,
    stop_out_rate: p.metrics.stopOutRate,
    rank: index + 1,
  }));

  await runDir.writeArtifact('frontier', frontierArtifacts as unknown as Array<Record<string, unknown>>);

  logger.info('Wrote V1 baseline frontier', {
    runId,
    callerName,
    params: frontierArtifacts.length,
    feasible: frontierArtifacts.filter((p) => p.meets_constraints).length,
  });
}

/**
 * Write per-caller V1 baseline frontiers to artifacts
 */
export async function writeV1BaselinePerCallerFrontiers(
  runDir: RunDirectory,
  runId: string,
  results: Map<string, V1BaselinePerCallerResult>
): Promise<void> {
  const allFrontierArtifacts: FrontierArtifact[] = [];

  for (const [callerName, result] of results) {
    if (result.allParams.length === 0) continue;

    const frontierArtifacts: FrontierArtifact[] = result.allParams.map((p, index) => ({
      run_id: runId,
      caller_name: callerName,
      policy_params: JSON.stringify({
        tp_mult: p.params.tp_mult,
        sl_mult: p.params.sl_mult,
        max_hold_hrs: p.params.max_hold_hrs,
      }),
      meets_constraints: p.meetsConstraints,
      objective_score: p.score,
      avg_return_bps: p.metrics.avgReturnBps,
      median_return_bps: p.metrics.medianReturnBps,
      stop_out_rate: p.metrics.stopOutRate,
      rank: index + 1,
    }));

    allFrontierArtifacts.push(...frontierArtifacts);
  }

  if (allFrontierArtifacts.length > 0) {
    await runDir.writeArtifact('frontier', allFrontierArtifacts as unknown as Array<Record<string, unknown>>);

    logger.info('Wrote per-caller V1 baseline frontiers', {
      runId,
      callers: results.size,
      totalParams: allFrontierArtifacts.length,
      feasible: allFrontierArtifacts.filter((p) => p.meets_constraints).length,
    });
  }
}

