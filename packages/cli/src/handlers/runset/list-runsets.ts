/**
 * List RunSets Handler
 *
 * Lists RunSets with optional filters.
 *
 * @packageDocumentation
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import type { listRunsetsSchema } from '../../command-defs/runset.js';
import type { RunSetWithResolution } from '@quantbot/core';

export type ListRunsetsArgs = z.infer<typeof listRunsetsSchema>;

/**
 * Result from listing RunSets
 */
export interface ListRunsetsResult {
  /** Array of RunSets */
  runsets: RunSetWithResolution[];
  /** Total count */
  total: number;
}

/**
 * List RunSets with optional filters
 *
 * Pure handler - depends only on ports.
 * Gets runset resolver from context and calls queryRunSets.
 *
 * @param args - Validated arguments
 * @param ctx - Command context with services
 * @returns List of RunSets
 *
 * @example
 * ```typescript
 * const result = await listRunsetsHandler(
 *   { tags: ['baseline'], frozen: true, limit: 10 },
 *   ctx
 * );
 * console.log(`Found ${result.total} frozen baseline RunSets`);
 * ```
 */
export async function listRunsetsHandler(
  args: ListRunsetsArgs,
  ctx: CommandContext
): Promise<ListRunsetsResult> {
  // Get runset resolver from context
  const resolver = ctx.services.runsetResolver();

  // Build filter
  const filter = {
    tags: args.tags,
    datasetId: args.dataset,
    frozen: args.frozen,
    mode: args.mode,
    limit: args.limit || 100,
  };

  // Query RunSets
  const runsets = await resolver.queryRunSets(filter);

  return {
    runsets,
    total: runsets.length,
  };
}

