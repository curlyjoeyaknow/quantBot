/**
 * Lake Commands
 * =============
 * Parquet Lake v1 export commands
 */

import type { Command } from 'commander';
import { z } from 'zod';
import type { PackageCommandModule } from '../types/index.js';
import { commandRegistry } from '../core/command-registry.js';
import { defineCommand } from '../core/defineCommand.js';
import { die } from '../core/cliErrors.js';
import { coerceNumber, coerceBoolean } from '../core/coerce.js';
import type { CommandContext } from '../core/command-context.js';
import { exportRunSlicesLakeHandler } from '../handlers/lake/export-run-slices-lake.js';

/**
 * Schema for export-run-slices command
 */
export const exportRunSlicesSchema = z.object({
  runId: z.string().optional(),
  interval: z.string(), // e.g., "1s", "5s", "1m"
  window: z.string(), // e.g., "pre52_post4948"
  alerts: z.string(), // Path to alerts.parquet or alerts.csv
  dataRoot: z.string().default('data'),
  chain: z.string().default('solana'),
  compression: z.enum(['zstd', 'snappy', 'none']).default('zstd'),
  targetFileMb: z.number().int().positive().default(512),
  strictCoverage: z.boolean().default(false),
  minRequiredPre: z.number().int().positive().default(52),
  targetTotal: z.number().int().positive().default(5000),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

export type ExportRunSlicesArgs = z.infer<typeof exportRunSlicesSchema>;

/**
 * Register lake commands
 */
export function registerLakeCommands(program: Command): void {
  const lakeCmd = program.command('lake').description('Parquet Lake v1 export operations');

  // export-run-slices command
  const exportRunSlicesCmd = lakeCmd
    .command('export-run-slices')
    .description('Export run-scoped slices to Parquet Lake v1 format')
    .option('--run-id <id>', 'Run ID (auto-generated if not provided)')
    .requiredOption('--interval <interval>', 'Candle interval (e.g., 1s, 5s, 1m, 5m)')
    .requiredOption('--window <window>', 'Window spec (e.g., pre52_post4948)')
    .requiredOption('--alerts <path>', 'Path to alerts.parquet or alerts.csv')
    .option('--data-root <path>', 'Data root directory', 'data')
    .option('--chain <chain>', 'Chain name', 'solana')
    .option('--compression <type>', 'Compression type (zstd, snappy, none)', 'zstd')
    .option('--target-file-mb <mb>', 'Target file size in MB', '512')
    .option('--strict-coverage', 'Drop slices that do not meet coverage thresholds', false)
    .option('--min-required-pre <n>', 'Minimum pre-candles required', '52')
    .option('--target-total <n>', 'Target total candles per alert', '5000')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(exportRunSlicesCmd, {
    name: 'export-run-slices',
    packageName: 'lake',
    coerce: (raw) => ({
      ...raw,
      targetFileMb: raw.targetFileMb ? coerceNumber(raw.targetFileMb, 'target-file-mb') : 512,
      strictCoverage: raw.strictCoverage
        ? coerceBoolean(raw.strictCoverage, 'strict-coverage')
        : false,
      minRequiredPre: raw.minRequiredPre
        ? coerceNumber(raw.minRequiredPre, 'min-required-pre')
        : 52,
      targetTotal: raw.targetTotal ? coerceNumber(raw.targetTotal, 'target-total') : 5000,
    }),
    validate: (opts) => exportRunSlicesSchema.parse(opts),
    onError: die,
  });
}

/**
 * Lake command module
 */
const lakeModule: PackageCommandModule = {
  packageName: 'lake',
  description: 'Parquet Lake v1 export operations',
  commands: [
    {
      name: 'export-run-slices',
      description: 'Export run-scoped slices to Parquet Lake v1 format',
      schema: exportRunSlicesSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as ExportRunSlicesArgs;
        return await exportRunSlicesLakeHandler(typedArgs, ctx);
      },
      examples: [
        'quantbot lake export-run-slices --interval 1s --window pre52_post4948 --alerts inputs/alerts.parquet',
        'quantbot lake export-run-slices --interval 1m --window pre10_post20 --alerts alerts.csv --strict-coverage',
      ],
    },
  ],
};

// Register module
commandRegistry.registerPackage(lakeModule);
