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
import { exportSlicesForAlertsHandler, exportSlicesForAlertsSchema } from '../handlers/slices/export-slices-for-alerts.js';
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
      handler: async (args: unknown, ctx: unknown) => {
        const typedArgs = args as z.infer<typeof exportSliceSchema>;
        const typedCtx = ctx as CommandContext;
        return await exportSliceHandler(typedArgs, typedCtx);
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
      handler: async (args: unknown, ctx: unknown) => {
        const typedArgs = args as z.infer<typeof validateSliceSchema>;
        const typedCtx = ctx as CommandContext;
        return await validateSliceHandler(typedArgs, typedCtx);
      },
      examples: ['quantbot slices validate slice.manifest.json'],
    },
    {
      name: 'export-for-alerts',
      description: 'Export candle slices for all alerts in a time period (uses catalog layout)',
      schema: exportSlicesForAlertsSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedArgs = args as z.infer<typeof exportSlicesForAlertsSchema>;
        const typedCtx = ctx as CommandContext;
        return await exportSlicesForAlertsHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot slices export-for-alerts --from 2025-12-01T00:00:00Z --to 2025-12-02T00:00:00Z',
        'quantbot slices export-for-alerts --from 2025-12-01T00:00:00Z --to 2025-12-02T00:00:00Z --caller Brook --catalog-path ./catalog',
      ],
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

  // Export slices for alerts command
  slicesCmd
    .command('export-for-alerts')
    .description('Export candle slices for all alerts in a time period (uses catalog layout)')
    .requiredOption('--from <date>', 'Start date (ISO 8601, e.g., 2025-12-01T00:00:00Z)')
    .requiredOption('--to <date>', 'End date (ISO 8601, e.g., 2025-12-02T00:00:00Z)')
    .option('--caller <name>', 'Filter by caller name')
    .option('--catalog-path <path>', 'Catalog base path', './catalog')
    .option('--pre-window <minutes>', 'Pre-window minutes (before alert)', '260')
    .option('--post-window <minutes>', 'Post-window minutes (after alert)', '1440')
    .option('--dataset <dataset>', 'Dataset to export (candles_1s, candles_15s, candles_1m)', 'candles_1m')
    .option('--chain <chain>', 'Chain (sol, eth, base, bsc)', 'sol')
    .option('--duckdb <path>', 'DuckDB path')
    .option('--max-alerts <number>', 'Maximum alerts to process', '1000')
    .option('--format <format>', 'Output format', 'json')
    .action(async (options) => {
      const { execute } = await import('../core/execute.js');
      const commandDef = commandRegistry.getCommand('slices', 'export-for-alerts');
      if (!commandDef) {
        throw new Error('Command not found in registry');
      }
      await execute(commandDef, options);
    });
}
