/**
 * Resolve RunSet Handler
 *
 * Resolves RunSet to concrete run_ids and artifacts.
 * This is the core Resolver operation.
 *
 * @packageDocumentation
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import type { resolveRunsetSchema } from '../../command-defs/runset.js';
import type { RunSetResolution } from '@quantbot/core';

export type ResolveRunsetArgs = z.infer<typeof resolveRunsetSchema>;

/**
 * Result from resolving a RunSet
 */
export interface ResolveRunsetResult {
  /** Resolution result */
  resolution: RunSetResolution;
  /** Success message */
  message: string;
}

/**
 * Resolve RunSet to concrete run_ids and artifacts
 *
 * Pure handler - depends only on ports.
 * Gets runset resolver from context and calls resolveRunSet.
 *
 * Behavior:
 * - If frozen=true: returns pinned resolution
 * - If frozen=false: re-resolves based on current data
 * - If force=true: re-resolves even if frozen
 *
 * @param args - Validated arguments
 * @param ctx - Command context with services
 * @returns Resolution result
 *
 * @example
 * ```typescript
 * const result = await resolveRunsetHandler(
 *   { runsetId: 'brook_baseline_2025Q4', force: false },
 *   ctx
 * );
 * console.log(`Resolved: ${result.resolution.runIds.length} runs`);
 * ```
 */
export async function resolveRunsetHandler(
  args: ResolveRunsetArgs,
  ctx: CommandContext
): Promise<ResolveRunsetResult> {
  // Get runset resolver from context
  const resolver = ctx.services.runsetResolver();

  // Resolve RunSet (finds matching runs/artifacts)
  const resolution = await resolver.resolveRunSet(args.runsetId, args.force);

  return {
    resolution,
    message: `Resolved: ${resolution.runIds.length} runs, ${resolution.artifacts.length} artifacts${resolution.frozen ? ' (frozen)' : ''}`,
  };
}

