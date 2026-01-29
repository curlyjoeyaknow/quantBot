/**
 * Find Experiments by Inputs Handler (Research Package)
 *
 * Finds experiments by input artifact IDs.
 * Uses ExperimentTrackerPort for experiment tracking.
 *
 * @packageDocumentation
 */

import type { z } from 'zod';
import type { CommandContext } from '../../../core/command-context.js';
import type { findResearchExperimentsByInputsSchema } from '../../../command-defs/research-experiments.js';
import type { Experiment } from '@quantbot/core';

export type FindResearchExperimentsByInputsArgs = z.infer<
  typeof findResearchExperimentsByInputsSchema
>;

/**
 * Result from finding experiments by inputs
 */
export interface FindResearchExperimentsByInputsResult {
  /** Array of matching experiments */
  experiments: Experiment[];
  /** Total count */
  total: number;
  /** Input artifact IDs searched */
  searchedArtifacts: string[];
}

/**
 * Find experiments by input artifact IDs
 *
 * Pure handler - depends only on ports.
 * Gets experiment tracker from context and calls findByInputArtifacts.
 *
 * Useful for lineage queries: "which experiments used this artifact?"
 *
 * @param args - Validated arguments
 * @param ctx - Command context with services
 * @returns Array of matching experiments
 *
 * @example
 * ```typescript
 * const result = await findResearchExperimentsByInputsHandler(
 *   { artifacts: ['alert-1', 'ohlcv-1'] },
 *   ctx
 * );
 * console.log(`Found ${result.total} experiments using these artifacts`);
 * ```
 */
export async function findResearchExperimentsByInputsHandler(
  args: FindResearchExperimentsByInputsArgs,
  ctx: CommandContext
): Promise<FindResearchExperimentsByInputsResult> {
  // Get experiment tracker from context (lazy initialization)
  const experimentTracker = ctx.services.experimentTracker();

  // Call port method (adapter handles DuckDB operations)
  const experiments = await experimentTracker.findByInputArtifacts(args.artifacts);

  return {
    experiments,
    total: experiments.length,
    searchedArtifacts: args.artifacts,
  };
}
