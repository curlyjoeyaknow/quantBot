/**
 * Resolve EVM Chains Handler
 * 
 * Identifies tokens with generic 'evm' chain and resolves them to specific chains.
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { resolveEvmChainsSchema } from '../../commands/metadata.js';
import { resolveEvmChains } from '@quantbot/workflows';
import { getBirdeyeClient } from '@quantbot/api-clients';

export type ResolveEvmChainsArgs = z.infer<typeof resolveEvmChainsSchema>;

export async function resolveEvmChainsHandler(
  args: ResolveEvmChainsArgs,
  _ctx: CommandContext
) {
  // Create context with Birdeye client
  const birdeyeClient = getBirdeyeClient();
  
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

