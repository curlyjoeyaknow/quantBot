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
import { getBirdeyeClient } from '@quantbot/api-clients';

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
  // Create context with Birdeye client
  const birdeyeClient = getBirdeyeClient();

  // CONSOLE LOGGING ALLOWED HERE (composition root)
  const context = {
    logger: {
      info: (msg: string, ctx?: unknown) => console.log(`[INFO] ${msg}`, ctx || ''),
      warn: (msg: string, ctx?: unknown) => console.warn(`[WARN] ${msg}`, ctx || ''),
      error: (msg: string, ctx?: unknown) => console.error(`[ERROR] ${msg}`, ctx || ''),
      debug: (msg: string, ctx?: unknown) => console.debug(`[DEBUG] ${msg}`, ctx || ''),
    },
    birdeyeClient,
  };

  return await resolveEvmChains(
    {
      duckdbPath: args.duckdb,
      useClickHouse: args.useClickhouse,
      useDuckDB: args.useDuckdb,
      limit: args.limit,
      dryRun: args.dryRun,
      errorMode: 'collect', // Default to collect errors
    },
    context
  );
}
