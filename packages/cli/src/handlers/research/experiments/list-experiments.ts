/**
 * List Experiments Handler (Research Package)
 *
 * Lists experiments with optional filters.
 * Uses ExperimentTrackerPort for experiment tracking.
 *
 * @packageDocumentation
 */

import type { z } from 'zod';
import type { CommandContext } from '../../../core/command-context.js';
import type { listResearchExperimentsSchema } from '../../../command-defs/research-experiments.js';
import type { Experiment } from '@quantbot/core';

export type ListResearchExperimentsArgs = z.infer<typeof listResearchExperimentsSchema>;

/**
 * Result from listing experiments
 */
export interface ListResearchExperimentsResult {
  /** Array of experiments */
  experiments: Experiment[];
  /** Total count */
  total: number;
}

/**
 * List experiments with optional filters
 *
 * Pure handler - depends only on ports.
 * Gets experiment tracker from context and calls listExperiments.
 *
 * @param args - Validated arguments
 * @param ctx - Command context with services
 * @returns List of experiments
 *
 * @example
 * ```typescript
 * const result = await listResearchExperimentsHandler(
 *   { status: 'completed', limit: 10 },
 *   ctx
 * );
 * console.log(`Found ${result.total} experiments`);
 * ```
 */
export async function listResearchExperimentsHandler(
  args: ListResearchExperimentsArgs,
  ctx: CommandContext
): Promise<ListResearchExperimentsResult> {
  // Get experiment tracker from context (lazy initialization)
  const experimentTracker = ctx.services.experimentTracker();

  // Build filter from args
  const filter = {
    status: args.status,
    gitCommit: args.gitCommit,
    minCreatedAt: args.minCreatedAt,
    maxCreatedAt: args.maxCreatedAt,
    limit: args.limit || 100,
  };

  // Call port method (adapter handles DuckDB operations)
  const experiments = await experimentTracker.listExperiments(filter);

  return {
    experiments,
    total: experiments.length,
  };
}
