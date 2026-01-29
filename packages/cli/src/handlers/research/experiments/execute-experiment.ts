/**
 * Execute Experiment Handler (Research Package)
 *
 * Executes an experiment with frozen artifact sets.
 * Uses executeExperiment workflow from @quantbot/workflows.
 *
 * @packageDocumentation
 */

import type { z } from 'zod';
import type { CommandContext } from '../../../core/command-context.js';
import type { executeResearchExperimentSchema } from '../../../command-defs/research-experiments.js';
import { executeExperiment } from '@quantbot/workflows/experiments';

export type ExecuteResearchExperimentArgs = z.infer<typeof executeResearchExperimentSchema>;

/**
 * Result from executing an experiment
 */
export interface ExecuteResearchExperimentResult {
  /** Experiment ID */
  experimentId: string;
  /** Execution status */
  status: 'completed' | 'failed';
  /** Output artifact IDs */
  outputs?: {
    trades?: string;
    metrics?: string;
    curves?: string;
    diagnostics?: string;
  };
  /** Duration in milliseconds */
  duration?: number;
  /** Error message (if failed) */
  error?: string;
  /** Success message */
  message: string;
}

/**
 * Execute an experiment
 *
 * Pure handler - depends only on ports.
 * Gets services from context and calls executeExperiment workflow.
 *
 * Execution flow:
 * 1. Get experiment definition from tracker
 * 2. Validate input artifacts exist
 * 3. Build DuckDB projection from Parquet artifacts
 * 4. Execute simulation
 * 5. Publish results as artifacts
 * 6. Update experiment status and outputs
 *
 * @param args - Validated arguments
 * @param ctx - Command context with services
 * @returns Execution result with output artifact IDs
 *
 * @example
 * ```typescript
 * const result = await executeResearchExperimentHandler(
 *   { experimentId: 'exp-20260129120000-abc123' },
 *   ctx
 * );
 * console.log(`Status: ${result.status}`);
 * console.log(`Trades: ${result.outputs?.trades}`);
 * ```
 */
export async function executeResearchExperimentHandler(
  args: ExecuteResearchExperimentArgs,
  ctx: CommandContext
): Promise<ExecuteResearchExperimentResult> {
  // Get services from context (lazy initialization)
  const experimentTracker = ctx.services.experimentTracker();
  const artifactStore = ctx.services.artifactStore();
  const projectionBuilder = ctx.services.projectionBuilder();

  // Get experiment definition
  const definition = await experimentTracker.getExperiment(args.experimentId);

  // Execute experiment (workflow handles all steps)
  const startTime = Date.now();
  try {
    const result = await executeExperiment(definition, {
      artifactStore,
      projectionBuilder,
      experimentTracker,
    });

    const duration = Date.now() - startTime;

    return {
      experimentId: args.experimentId,
      status: 'completed',
      outputs: result.outputs,
      duration,
      message: `Experiment completed: ${args.experimentId}`,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      experimentId: args.experimentId,
      status: 'failed',
      duration,
      error: errorMessage,
      message: `Experiment failed: ${errorMessage}`,
    };
  }
}
