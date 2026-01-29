/**
 * Create RunSet Handler
 *
 * Creates a new RunSet with declarative selection spec.
 * Writes spec to Parquet (append-only).
 *
 * @packageDocumentation
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import type { createRunsetSchema } from '../../command-defs/runset.js';
import type { RunSetWithResolution, RunSetSpec } from '@quantbot/core';

export type CreateRunsetArgs = z.infer<typeof createRunsetSchema>;

/**
 * Result from creating a RunSet
 */
export interface CreateRunsetResult {
  /** Created RunSet with optional resolution */
  runset: RunSetWithResolution;
  /** Success message */
  message: string;
}

/**
 * Create a new RunSet
 *
 * Pure handler - depends only on ports.
 * Gets runset resolver from context and calls createRunSet.
 *
 * A RunSet is a logical selection (declarative spec), not data.
 * It describes WHAT you want, not WHERE it is.
 *
 * @param args - Validated arguments
 * @param ctx - Command context with services
 * @returns Created RunSet
 *
 * @example
 * ```typescript
 * const result = await createRunsetHandler(
 *   {
 *     id: 'brook_baseline_2025Q4',
 *     name: 'Brook Baseline Q4 2025',
 *     dataset: 'ohlcv_v2_2025Q4',
 *     caller: 'whale_watcher',
 *     from: '2025-10-01',
 *     to: '2025-12-31',
 *     tags: ['baseline', 'q4'],
 *     autoResolve: true,
 *   },
 *   ctx
 * );
 * console.log(`Created: ${result.runset.spec.runsetId}`);
 * ```
 */
export async function createRunsetHandler(
  args: CreateRunsetArgs,
  ctx: CommandContext
): Promise<CreateRunsetResult> {
  // Get runset resolver from context
  const resolver = ctx.services.runsetResolver();

  // Build RunSet spec
  const spec: RunSetSpec = {
    runsetId: args.id,
    name: args.name,
    description: args.description,
    datasetId: args.dataset,
    universe: {
      callers: args.caller ? [args.caller] : undefined,
      chains: args.chain ? [args.chain] : undefined,
      venues: args.venue ? [args.venue] : undefined,
      minMarketCap: args.minMarketCap,
      maxMarketCap: args.maxMarketCap,
      minVolume: args.minVolume,
    },
    timeBounds: {
      from: args.from,
      to: args.to,
      alertWindowPolicy: args.alertWindowPolicy,
    },
    strategy: {
      strategyFamily: args.strategyFamily,
      strategyHash: args.strategyHash,
      engineVersion: args.engineVersion,
    },
    tags: args.tags,
    latest: args.latest,
    frozen: false, // Always start unfrozen
    createdAt: new Date().toISOString(),
    specVersion: '1.0.0',
  };

  // Create RunSet (writes to Parquet)
  const runset = await resolver.createRunSet({
    spec,
    autoResolve: args.autoResolve,
  });

  return {
    runset,
    message: `RunSet created: ${spec.runsetId}${args.autoResolve ? ' (resolved)' : ''}`,
  };
}

