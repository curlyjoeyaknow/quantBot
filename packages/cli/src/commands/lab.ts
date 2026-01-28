/**
 * Lab Commands
 * ============
 * Quick overlay backtesting for exit strategy experimentation
 *
 * Lab is designed for quick experimentation with exit strategies using overlay backtesting.
 * It assumes immediate entry at call time and tests different exit overlays.
 */

import type { Command } from 'commander';
import { z } from 'zod';
import type { PackageCommandModule } from '../types/index.js';
import { commandRegistry } from '../core/command-registry.js';
import { defineCommand } from '../core/defineCommand.js';
import { die } from '../core/cliErrors.js';
import { coerceNumber, coerceJson } from '../core/coerce.js';
import type { CommandContext } from '../core/command-context.js';
import { labRunSchema, labSweepSchema, labExportParquetSchema } from '../command-defs/lab.js';
import { runLabHandler } from '../handlers/lab/run-lab.js';
import { sweepLabHandler } from '../handlers/lab/sweep-lab.js';
import { exportLabParquetHandler } from '../handlers/lab/export-parquet-lab.js';
import type { ExitOverlay } from '@quantbot/backtest';
import { coerceStringArray, coerceNumberArray } from '../core/coerce.js';

/**
 * Register lab commands
 */
export function registerLabCommands(program: Command): void {
  const labCmd = program
    .command('lab')
    .description('Quick overlay backtesting for exit strategy experimentation');

  // Run command
  const runCmd = labCmd
    .command('run')
    .description('Run overlay backtesting on calls from DuckDB')
    .option('--from <date>', 'Start date (ISO 8601)')
    .option('--to <date>', 'End date (ISO 8601)')
    .option('--caller <name>', 'Filter by caller name')
    .option('--mint <address>', 'Single mint address')
    .option('--limit <n>', 'Maximum calls to simulate', '100')
    .requiredOption(
      '--overlays <json>',
      'JSON array of exit overlays (e.g., \'[{"kind":"take_profit","takePct":100}]\')'
    )
    .option('--lag-ms <ms>', 'Entry lag in milliseconds', '10000')
    .option(
      '--entry-rule <rule>',
      'Entry rule: next_candle_open, next_candle_close, call_time_close',
      'next_candle_open'
    )
    .option('--timeframe-ms <ms>', 'Timeframe in milliseconds', String(24 * 60 * 60 * 1000))
    .option('--interval <interval>', 'Candle interval: 1m, 5m, 15m, 1h', '5m')
    .option('--taker-fee-bps <bps>', 'Taker fee in basis points', '30')
    .option('--slippage-bps <bps>', 'Slippage in basis points', '10')
    .option('--notional-usd <amount>', 'Position size in USD', '1000')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(runCmd, {
    name: 'run',
    packageName: 'lab',
    coerce: (raw) => ({
      ...raw,
      limit: raw.limit ? coerceNumber(raw.limit, 'limit') : 100,
      overlays: raw.overlays ? coerceJson<ExitOverlay[]>(raw.overlays, 'overlays') : undefined,
      lagMs: raw.lagMs ? coerceNumber(raw.lagMs, 'lag-ms') : 10000,
      timeframeMs: raw.timeframeMs
        ? coerceNumber(raw.timeframeMs, 'timeframe-ms')
        : 24 * 60 * 60 * 1000,
      takerFeeBps: raw.takerFeeBps ? coerceNumber(raw.takerFeeBps, 'taker-fee-bps') : 30,
      slippageBps: raw.slippageBps ? coerceNumber(raw.slippageBps, 'slippage-bps') : 10,
      notionalUsd: raw.notionalUsd ? coerceNumber(raw.notionalUsd, 'notional-usd') : 1000,
    }),
    validate: (opts) => labRunSchema.parse(opts),
    onError: die,
  });

  // Sweep command
  const sweepCmd = labCmd
    .command('sweep')
    .description(
      'Run parameter sweep across overlays, intervals, and lags (queries DuckDB directly)'
    )
    .option('--config <path>', 'Path to config file (YAML/JSON)')
    .option('--from <date>', 'Start date (ISO 8601)')
    .option('--to <date>', 'End date (ISO 8601)')
    .option('--caller <name>', 'Filter by caller name')
    .option('--mint <address>', 'Single mint address')
    .option('--limit <n>', 'Maximum calls to simulate', '1000')
    .option('--overlays-file <path>', 'Path to JSON file containing overlay sets')
    .option('--overlay-sets-file <path>', 'Alias for --overlays-file')
    .option('--intervals <json>', 'JSON array of intervals: ["1m","5m"]')
    .option('--lags-ms <json>', 'JSON array of lag values in ms: [10000,30000]')
    .option('--out <dir>', 'Output directory (required)')
    .option(
      '--entry-rule <rule>',
      'Entry rule: next_candle_open, next_candle_close, call_time_close',
      'next_candle_open'
    )
    .option('--timeframe-ms <ms>', 'Timeframe in milliseconds', String(24 * 60 * 60 * 1000))
    .option('--taker-fee-bps <bps>', 'Taker fee in basis points', '30')
    .option('--slippage-bps <bps>', 'Slippage in basis points', '10')
    .option('--notional-usd <amount>', 'Position size in USD', '1000')
    .option('--resume', 'Resume from previous run', false)
    .option('--parquet-dir <dir>', 'Read from Parquet directory (enables parallel processing)')
    .option(
      '--workers <n>',
      'Number of parallel workers (default: CPU count)',
      String(require('os').cpus().length)
    )
    .option('--format <format>', 'Output format', 'table');

  defineCommand(sweepCmd, {
    name: 'sweep',
    packageName: 'lab',
    coerce: (raw) => ({
      ...raw,
      limit: raw.limit ? coerceNumber(raw.limit, 'limit') : 1000,
      intervals: raw.intervals ? coerceStringArray(raw.intervals, 'intervals') : undefined,
      lagsMs: raw.lagsMs ? coerceNumberArray(raw.lagsMs, 'lags-ms') : undefined,
      timeframeMs: raw.timeframeMs
        ? coerceNumber(raw.timeframeMs, 'timeframe-ms')
        : 24 * 60 * 60 * 1000,
      takerFeeBps: raw.takerFeeBps ? coerceNumber(raw.takerFeeBps, 'taker-fee-bps') : 30,
      slippageBps: raw.slippageBps ? coerceNumber(raw.slippageBps, 'slippage-bps') : 10,
      notionalUsd: raw.notionalUsd ? coerceNumber(raw.notionalUsd, 'notional-usd') : 1000,
      resume: raw.resume === true || raw.resume === 'true',
      workers: raw.workers ? coerceNumber(raw.workers, 'workers') : undefined,
    }),
    validate: (opts) => labSweepSchema.parse(opts),
    onError: die,
  });

  // Export-parquet command
  const exportParquetCmd = labCmd
    .command('export-parquet')
    .description('Export calls from DuckDB to Parquet format for parallel processing')
    .option('--duckdb <path>', 'DuckDB path (defaults to DUCKDB_PATH env var)')
    .option('--from <date>', 'Start date (ISO 8601)')
    .option('--to <date>', 'End date (ISO 8601)')
    .option('--caller <name>', 'Filter by caller name')
    .option('--mint <address>', 'Single mint address')
    .option('--limit <n>', 'Maximum calls to export', '100000')
    .requiredOption('--out <dir>', 'Output directory for Parquet files');

  defineCommand(exportParquetCmd, {
    name: 'export-parquet',
    packageName: 'lab',
    coerce: (raw) => ({
      ...raw,
      limit: raw.limit ? coerceNumber(raw.limit, 'limit') : 100000,
    }),
    validate: (opts) => labExportParquetSchema.parse(opts),
    onError: die,
  });
}

/**
 * Register as package command module
 */
const labModule: PackageCommandModule = {
  packageName: 'lab',
  description: 'Quick overlay backtesting for exit strategy experimentation',
  commands: [
    {
      name: 'run',
      description: 'Run overlay backtesting on calls from DuckDB',
      schema: labRunSchema,
      handler: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof labRunSchema>;
        return await runLabHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot lab run --overlays \'[{"kind":"take_profit","takePct":100}]\' --caller Brook',
        'quantbot lab run --overlays \'[{"kind":"take_profit","takePct":100},{"kind":"stop_loss","stopPct":20}]\' --from 2024-01-01T00:00:00Z --to 2024-01-31T23:59:59Z',
        'quantbot lab run --overlays \'[{"kind":"combo","legs":[{"kind":"take_profit","takePct":200},{"kind":"stop_loss","stopPct":20}]}]\' --lag-ms 30000',
      ],
    },
    {
      name: 'sweep',
      description:
        'Run parameter sweep across overlays, intervals, and lags (queries DuckDB directly)',
      schema: labSweepSchema,
      handler: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof labSweepSchema>;
        return await sweepLabHandler(typedArgs, typedCtx);
      },
      examples: [
        "quantbot lab sweep --overlays-file overlays.json --intervals '[\"5m\"]' --lags-ms '[10000]' --out results/lab-sweep/ --caller Brook",
        'quantbot lab sweep --config sweep-config.yaml --out results/lab-sweep/',
        'quantbot lab sweep --parquet-dir exports/calls-2024-01/ --overlays-file overlays.json --out results/lab-sweep/ --workers 8',
      ],
    },
    {
      name: 'export-parquet',
      description: 'Export calls from DuckDB to Parquet format for parallel processing',
      schema: labExportParquetSchema,
      handler: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof labExportParquetSchema>;
        return await exportLabParquetHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot lab export-parquet --out exports/calls-2024-01/ --caller Brook',
        'quantbot lab export-parquet --out exports/calls-2024-01/ --from 2024-01-01T00:00:00Z --to 2024-01-31T23:59:59Z',
      ],
    },
  ],
};

// Register the module
commandRegistry.registerPackage(labModule);
