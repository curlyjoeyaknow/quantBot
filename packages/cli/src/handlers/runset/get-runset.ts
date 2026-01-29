/**
 * Get RunSet Handler
 *
 * Gets a specific RunSet by ID.
 *
 * @packageDocumentation
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import type { getRunsetSchema } from '../../command-defs/runset.js';
import type { RunSetWithResolution } from '@quantbot/core';

export type GetRunsetArgs = z.infer<typeof getRunsetSchema>;

/**
 * Result from getting a RunSet
 */
export interface GetRunsetResult {
  /** RunSet with latest resolution */
  runset: RunSetWithResolution | null;
  /** Whether RunSet was found */
  found: boolean;
}

/**
 * Get RunSet by ID
 *
 * Pure handler - depends only on ports.
 * Gets runset resolver from context and calls getRunSet.
 *
 * @param args - Validated arguments
 * @param ctx - Command context with services
 * @returns RunSet with latest resolution
 *
 * @example
 * ```typescript
 * const result = await getRunsetHandler(
 *   { runsetId: 'brook_baseline_2025Q4' },
 *   ctx
 * );
 * if (result.found) {
 *   console.log(`Mode: ${result.runset.mode}`);
 *   console.log(`Runs: ${result.runset.resolution?.runIds.length || 0}`);
 * }
 * ```
 */
export async function getRunsetHandler(
  args: GetRunsetArgs,
  ctx: CommandContext
): Promise<GetRunsetResult> {
  // Get runset resolver from context
  const resolver = ctx.services.runsetResolver();

  try {
    // Get RunSet (loads spec + latest resolution)
    const runset = await resolver.getRunSet(args.runsetId);

    return {
      runset,
      found: true,
    };
  } catch (error) {
    // If RunSet not found, return null
    if (error instanceof Error && error.message.includes('not found')) {
      return {
        runset: null,
        found: false,
      };
    }
    throw error;
  }
}

