/**
 * Freeze RunSet Handler
 *
 * Freezes RunSet (pins resolution for reproducibility).
 * This is the transition from exploration to reproducible mode.
 *
 * @packageDocumentation
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import type { freezeRunsetSchema } from '../../command-defs/runset.js';
import type { RunSetResolution } from '@quantbot/core';

export type FreezeRunsetArgs = z.infer<typeof freezeRunsetSchema>;

/**
 * Result from freezing a RunSet
 */
export interface FreezeRunsetResult {
  /** Frozen resolution */
  resolution: RunSetResolution;
  /** Success message */
  message: string;
}

/**
 * Freeze RunSet (pin resolution for reproducibility)
 *
 * Pure handler - depends only on ports.
 * Gets runset resolver from context and calls freezeRunSet.
 *
 * Freezing a RunSet:
 * - Pins the current resolution
 * - Sets frozen=true
 * - Stores resolution snapshot
 * - Future resolves return the pinned resolution
 *
 * This is the transition from exploration to reproducible mode.
 *
 * @param args - Validated arguments
 * @param ctx - Command context with services
 * @returns Frozen resolution
 *
 * @example
 * ```typescript
 * const result = await freezeRunsetHandler(
 *   { runsetId: 'brook_baseline_2025Q4' },
 *   ctx
 * );
 * console.log(`Frozen: ${result.resolution.runIds.length} runs`);
 * console.log(`Resolution hash: ${result.resolution.contentHash}`);
 * ```
 */
export async function freezeRunsetHandler(
  args: FreezeRunsetArgs,
  ctx: CommandContext
): Promise<FreezeRunsetResult> {
  // Get runset resolver from context
  const resolver = ctx.services.runsetResolver();

  // Freeze RunSet (pins resolution)
  const resolution = await resolver.freezeRunSet(args.runsetId);

  return {
    resolution,
    message: `RunSet frozen: ${args.runsetId} (${resolution.runIds.length} runs, resolution_hash=${resolution.contentHash.substring(0, 8)}...)`,
  };
}

