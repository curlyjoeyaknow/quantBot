/**
 * Get Experiment Handler (Research Package)
 *
 * Gets a specific experiment by ID.
 * Uses ExperimentTrackerPort for experiment tracking.
 *
 * @packageDocumentation
 */

import type { z } from 'zod';
import type { CommandContext } from '../../../core/command-context.js';
import type { getResearchExperimentSchema } from '../../../command-defs/research-experiments.js';
import type { Experiment } from '@quantbot/core';

export type GetResearchExperimentArgs = z.infer<typeof getResearchExperimentSchema>;

/**
 * Result from getting an experiment
 */
export interface GetResearchExperimentResult {
  /** Experiment record (null if not found) */
  experiment: Experiment | null;
  /** Whether experiment was found */
  found: boolean;
}

/**
 * Get experiment by ID
 *
 * Pure handler - depends only on ports.
 * Gets experiment tracker from context and calls getExperiment.
 *
 * @param args - Validated arguments
 * @param ctx - Command context with services
 * @returns Experiment record or null if not found
 *
 * @example
 * ```typescript
 * const result = await getResearchExperimentHandler(
 *   { experimentId: 'exp-20260129120000-abc123' },
 *   ctx
 * );
 * if (result.found) {
 *   console.log(`Status: ${result.experiment.status}`);
 * }
 * ```
 */
export async function getResearchExperimentHandler(
  args: GetResearchExperimentArgs,
  ctx: CommandContext
): Promise<GetResearchExperimentResult> {
  // Get experiment tracker from context (lazy initialization)
  const experimentTracker = ctx.services.experimentTracker();

  try {
    // Call port method (adapter handles DuckDB operations)
    const experiment = await experimentTracker.getExperiment(args.experimentId);

    return {
      experiment,
      found: true,
    };
  } catch (error) {
    // If experiment not found, return null
    // Other errors will propagate (handled by executor)
    if (error instanceof Error && error.message.includes('not found')) {
      return {
        experiment: null,
        found: false,
      };
    }
    throw error;
  }
}
