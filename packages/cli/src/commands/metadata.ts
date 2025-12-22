/**
 * Metadata Commands
 *
 * Commands for managing and resolving token metadata.
 */

import type { Command } from 'commander';
import { z } from 'zod';
import type { PackageCommandModule } from '../types/index.js';
import { defineCommand } from '../core/defineCommand.js';
import { die } from '../core/cliErrors.js';
import { coerceBoolean, coerceNumber } from '../core/coerce.js';
import { commandRegistry } from '../core/command-registry.js';
import { resolveEvmChainsHandler } from './metadata/resolve-evm-chains.js';
import type { CommandContext } from '../core/command-context.js';

/**
 * Resolve EVM chains schema
 */
export const resolveEvmChainsSchema = z.object({
  duckdb: z.string().optional(),
  useClickhouse: z.boolean().default(true),
  useDuckdb: z.boolean().default(true),
  limit: z.number().int().positive().optional(),
  dryRun: z.boolean().default(false),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * Register metadata commands
 */
export function registerMetadataCommands(program: Command): void {
  const metadataCmd = program.command('metadata').description('Token metadata operations');

  // Resolve EVM chains
  const resolveEvmCmd = metadataCmd
    .command('resolve-evm')
    .description('Resolve generic EVM tokens to specific chains (ethereum, bsc, base)')
    .option('--duckdb <path>', 'Path to DuckDB database')
    .option('--use-clickhouse', 'Query ClickHouse for EVM tokens')
    .option('--use-duckdb', 'Query DuckDB for EVM tokens')
    .option('--limit <number>', 'Limit number of tokens to resolve')
    .option('--dry-run', 'Show what would be resolved without updating')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(resolveEvmCmd, {
    name: 'resolve-evm',
    packageName: 'metadata',
    coerce: (raw) => ({
      ...raw,
      useClickhouse:
        raw.useClickhouse !== undefined ? coerceBoolean(raw.useClickhouse, 'use-clickhouse') : true,
      useDuckdb: raw.useDuckdb !== undefined ? coerceBoolean(raw.useDuckdb, 'use-duckdb') : true,
      limit: raw.limit ? coerceNumber(raw.limit, 'limit') : undefined,
      dryRun: raw.dryRun !== undefined ? coerceBoolean(raw.dryRun, 'dry-run') : false,
    }),
    validate: (opts) => resolveEvmChainsSchema.parse(opts),
    onError: die,
  });
}

/**
 * Metadata command module
 */
const metadataModule: PackageCommandModule = {
  packageName: 'metadata',
  description: 'Token metadata operations',
  commands: [
    {
      name: 'resolve-evm',
      description: 'Resolve generic EVM tokens to specific chains',
      schema: resolveEvmChainsSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedArgs = args as z.infer<typeof resolveEvmChainsSchema>;
        const typedCtx = ctx as CommandContext;
        return await resolveEvmChainsHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot metadata resolve-evm --dry-run',
        'quantbot metadata resolve-evm --limit 10',
        'quantbot metadata resolve-evm --duckdb data/tele.duckdb',
      ],
    },
  ],
};

// Register module
commandRegistry.registerPackage(metadataModule);
