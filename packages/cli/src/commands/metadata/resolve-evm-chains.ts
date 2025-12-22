/**
 * CLI Composition Root for Resolving EVM Chains
 *
 * This is a composition root - it's allowed to:
 * - Log to console
 * - Do I/O
 * - Wire adapters
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { resolveEvmChainsSchema } from '../../commands/metadata.js';
import { resolveEvmChains } from '@quantbot/workflows';
import { createProductionContextWithPorts } from '@quantbot/workflows';

export type ResolveEvmChainsArgs = z.infer<typeof resolveEvmChainsSchema>;

/**
 * CLI handler for resolving EVM chains
 *
 * This function can:
 * - Log to console ✅
 * - Do I/O ✅
 * - Wire adapters ✅
 */
export async function resolveEvmChainsHandler(args: ResolveEvmChainsArgs, _ctx: CommandContext) {
  // Create workflow context with ports (composition root - allowed to wire adapters)
  const workflowCtx = await createProductionContextWithPorts();

  return await resolveEvmChains(
    {
      duckdbPath: args.duckdb,
      useClickHouse: args.useClickhouse,
      useDuckDB: args.useDuckdb,
      limit: args.limit,
      dryRun: args.dryRun,
      errorMode: 'collect', // Default to collect errors
    },
    workflowCtx
  );
}
