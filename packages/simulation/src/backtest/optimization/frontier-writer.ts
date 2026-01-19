/**
 * Frontier Writer
 *
 * Writes optimization frontier to artifacts.
 */

import type { RunDirectory } from '../artifacts/index.js';

// FrontierArtifact type definition
interface FrontierArtifact {
  run_id: string;
  caller_name: string;
  policy_params: string;
  meets_constraints: boolean;
  objective_score: number;
  avg_return_bps: number;
  median_return_bps: number;
  stop_out_rate: number;
  rank: number;
}
import type { OptimizationResult } from './policy-optimizer.js';
import type {
  V1BaselineOptimizationResult,
  V1BaselinePerCallerResult,
} from './v1-baseline-optimizer.js';
import { policyToId } from './policy-optimizer.js';
import { logger } from '@quantbot/infra/utils';

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
    meets_constraints: p.score.constraintsSatisfied,
    objective_score: p.score.score,
    avg_return_bps: p.score.metrics.avgReturnBps,
    median_return_bps: p.score.metrics.medianReturnBps,
    stop_out_rate: p.score.metrics.stopOutRate,
    rank: index + 1,
  }));

  await runDir.writeArtifact(
    'frontier',
    frontierArtifacts as unknown as Array<Record<string, unknown>>
  );

  logger.info('Wrote policy frontier', {
    runId,
    callerName,
    policies: frontierArtifacts.length,
    feasible: frontierArtifacts.filter((p) => p.meets_constraints).length,
  });
}

/**
 * Write V1 baseline optimization frontier to artifacts
 *
 * TODO: Implement once V1Baseline result structure is finalized
 */
export async function writeV1BaselineFrontier(
  runDir: RunDirectory,
  runId: string,
  callerName: string,
  result: V1BaselineOptimizationResult
): Promise<void> {
  logger.warn('V1 baseline frontier writing not yet implemented', { runId, callerName });
  // TODO: Map V1BaselineOptimizationResult.allResults to FrontierArtifact format
}

/**
 * Write per-caller V1 baseline frontiers to artifacts
 *
 * TODO: Implement once V1Baseline result structure is finalized
 */
export async function writeV1BaselinePerCallerFrontiers(
  runDir: RunDirectory,
  runId: string,
  results: Map<string, V1BaselinePerCallerResult>
): Promise<void> {
  logger.warn('Per-caller V1 baseline frontier writing not yet implemented', { runId });
  // TODO: Map V1BaselinePerCallerResult to FrontierArtifact format
}
