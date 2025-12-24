/**
 * Slice Commands
 *
 * Command definitions for slice export and analysis.
 */

import type { Command } from 'commander';
import { z } from 'zod';
import type { PackageCommandModule } from '../types/index.js';
import { commandRegistry } from '../core/command-registry.js';
import { defineCommand } from '../core/defineCommand.js';
import { exportSliceHandler } from '../handlers/slices/export-slice.js';
import { validateSliceHandler } from '../handlers/slices/validate-slice.js';
import type { CommandContext } from '../core/command-context.js';

/**
 * Export slice schema
 */
export const exportSliceSchema = z.object({
  dataset: z.enum(['candles_1m']), // Expandable
  chain: z.enum(['sol', 'eth', 'base', 'bsc']),
  from: z.string(), // ISO date string
  to: z.string(), // ISO date string
  tokens: z.string().optional(), // Comma-separated
  outputDir: z.string().default('./slices'),
  analysis: z.string().optional(), // SQL string
  format: z.enum(['json']).default('json'), // Only JSON initially
});

/**
 * Validate slice schema
 */
export const validateSliceSchema = z.object({
  manifest: z.string(), // Path to manifest file
  format: z.enum(['json', 'table']).default('json'),
});

/**
 * Slice command module
 */
const slicesModule: PackageCommandModule = {
  packageName: 'slices',
  description: 'Slice export and analysis operations',
  commands: [
    {
      name: 'export',
      description: 'Export data slice from ClickHouse to Parquet and analyze',
      schema: exportSliceSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof exportSliceSchema>;
        return await exportSliceHandler(typedArgs, ctx);
      },
      examples: [
        'quantbot slices export --dataset candles_1m --chain sol --from 2025-12-01 --to 2025-12-02',
        'quantbot slices export --dataset candles_1m --chain sol --from 2025-12-01 --to 2025-12-02 --tokens So111...,EPjF... --analysis "SELECT token_address, COUNT(*) FROM slice GROUP BY token_address"',
      ],
    },
    {
      name: 'validate',
      description: 'Validate a slice manifest',
      schema: validateSliceSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof validateSliceSchema>;
        return await validateSliceHandler(typedArgs, ctx);
      },
      examples: ['quantbot slices validate slice.manifest.json'],
    },
  ],
};

// Register module
commandRegistry.registerPackage(slicesModule);

/**
 * Register Commander.js commands
 */
export function registerSlicesCommands(program: Command): void {
  const slicesCmd = program.command('slices').description('Slice export and analysis operations');

  // Export command
  slicesCmd
    .command('export')
    .description('Export data slice from ClickHouse to Parquet and analyze')
    .requiredOption('--dataset <dataset>', 'Dataset name (e.g., candles_1m)')
    .requiredOption('--chain <chain>', 'Chain (sol, eth, base, bsc)')
    .requiredOption('--from <date>', 'Start date (ISO 8601, e.g., 2025-12-01)')
    .requiredOption('--to <date>', 'End date (ISO 8601, e.g., 2025-12-02)')
    .option('--tokens <tokens>', 'Comma-separated token addresses')
    .option('--output-dir <dir>', 'Output directory', './slices')
    .option('--analysis <sql>', 'SQL query to run on exported slice')
    .option('--format <format>', 'Output format', 'json')
    .action(async (options) => {
      const { execute } = await import('../core/execute.js');
      const commandDef = commandRegistry.getCommand('slices', 'export');
      if (!commandDef) {
        throw new Error('Command not found in registry');
      }
      await execute(commandDef, options);
    });

  // Validate command
  slicesCmd
    .command('validate')
    .description('Validate a slice manifest')
    .requiredOption('--manifest <file>', 'Path to manifest JSON file')
    .option('--format <format>', 'Output format', 'json')
    .action(async (options) => {
      const { execute } = await import('../core/execute.js');
      const commandDef = commandRegistry.getCommand('slices', 'validate');
      if (!commandDef) {
        throw new Error('Command not found in registry');
      }
      await execute(commandDef, options);
    });
}
