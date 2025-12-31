/**
 * Calls Commands
 */

import type { Command } from 'commander';
import { z } from 'zod';
import type { PackageCommandModule } from '../types/index.js';
import { defineCommand } from '../core/defineCommand.js';
import { die } from '../core/cliErrors.js';
import { commandRegistry } from '../core/command-registry.js';
import { coerceJson, coerceStringArray, coerceNumberArray, coerceNumber } from '../core/coerce.js';
import type { CommandContext } from '../core/command-context.js';
import { evaluateCallsHandler } from './calls/evaluate-calls.js';
import { sweepCallsHandler } from './calls/sweep-calls.js';
import { exportCallsFromDuckdbHandler } from './calls/export-calls-from-duckdb.js';
import { exportCallsWithSimulationHandler } from './calls/export-calls-with-simulation.js';
import {
  evaluateCallsSchema,
  sweepCallsSchema,
  exportCallsSchema,
  exportCallsWithSimulationSchema,
} from '../command-defs/calls.js';
import type { ExitOverlay } from '@quantbot/simulation';

/**
 * Register calls commands
 */
export function registerCallsCommands(program: Command): void {
  const callsCmd = program
    .command('calls')
    .description('Call evaluation and backtesting operations');

  // Evaluate command
  const evaluateCmd = callsCmd
    .command('evaluate')
    .description('Evaluate calls with overlay-based backtesting')
    .requiredOption('--calls-file <path>', 'Path to JSON file containing CallSignal[]')
    .option('--lag-ms <ms>', 'Entry lag in milliseconds')
    .option(
      '--entry-rule <rule>',
      'Entry rule: next_candle_open, next_candle_close, call_time_close',
      'next_candle_open'
    )
    .option('--timeframe-ms <ms>', 'Timeframe in milliseconds')
    .option('--interval <interval>', 'Candle interval: 1s, 1m, 5m, 1h', '5m')
    .option('--taker-fee-bps <bps>', 'Taker fee in basis points')
    .option('--slippage-bps <bps>', 'Slippage in basis points')
    .option('--overlays <json>', 'JSON array of exit overlays (required)')
    .option('--notional-usd <amount>', 'Position size in USD')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(evaluateCmd, {
    name: 'evaluate',
    packageName: 'calls',
    coerce: (raw) => ({
      ...raw,
      overlays: raw.overlays ? coerceJson<ExitOverlay[]>(raw.overlays, 'overlays') : undefined,
      lagMs: raw.lagMs ? coerceNumber(raw.lagMs, 'lag-ms') : 10_000,
      timeframeMs: raw.timeframeMs
        ? coerceNumber(raw.timeframeMs, 'timeframe-ms')
        : 24 * 60 * 60 * 1000,
      takerFeeBps: raw.takerFeeBps ? coerceNumber(raw.takerFeeBps, 'taker-fee-bps') : 30,
      slippageBps: raw.slippageBps ? coerceNumber(raw.slippageBps, 'slippage-bps') : 10,
      notionalUsd: raw.notionalUsd ? coerceNumber(raw.notionalUsd, 'notional-usd') : 1000,
    }),
    validate: (opts) => evaluateCallsSchema.parse(opts),
    onError: die,
  });

  // Export command
  const exportCmd = callsCmd
    .command('export')
    .description('Export calls from DuckDB to CallSignal JSON format')
    .requiredOption('--duckdb <path>', 'Path to DuckDB file')
    .requiredOption('--from-iso <iso>', 'Start date (ISO 8601)')
    .requiredOption('--to-iso <iso>', 'End date (ISO 8601)')
    .option('--caller-name <name>', 'Filter by caller name')
    .option('--limit <n>', 'Maximum calls to export')
    .requiredOption('--out <path>', 'Output JSON file path')
    .option('--format <format>', 'Output format', 'json');

  defineCommand(exportCmd, {
    name: 'export',
    packageName: 'calls',
    coerce: (raw) => ({
      ...raw,
      duckdbPath: raw.duckdb,
      fromIso: raw.fromIso,
      toIso: raw.toIso,
      callerName: raw.callerName,
      limit: raw.limit ? coerceNumber(raw.limit, 'limit') : 200,
    }),
    validate: (opts) => exportCallsSchema.parse(opts),
    onError: die,
  });

  // Export with backtest command
  const exportSimCmd = callsCmd
    .command('export-simulation')
    .description('Export calls from DuckDB with backtest results to CSV (deterministic replay)')
    .addHelpText('after', '\n⚠️  Note: Command name "export-simulation" is kept for backward compatibility. Results are from deterministic backtests.')
    .requiredOption('--duckdb <path>', 'Path to DuckDB file')
    .requiredOption('--from-iso <iso>', 'Start date (ISO 8601)')
    .requiredOption('--to-iso <iso>', 'End date (ISO 8601)')
    .option('--caller-name <name>', 'Filter by caller name')
    .option('--limit <n>', 'Maximum calls to export', '1000')
    .requiredOption('--out <path>', 'Output CSV file path')
    .option('--lag-ms <ms>', 'Entry lag in milliseconds', '10000')
    .option(
      '--entry-rule <rule>',
      'Entry rule: next_candle_open, next_candle_close, call_time_close',
      'next_candle_open'
    )
    .option('--timeframe-ms <ms>', 'Timeframe in milliseconds', String(24 * 60 * 60 * 1000))
    .option('--interval <interval>', 'Candle interval: 1s, 1m, 5m, 15m, 1h', '5m')
    .option('--taker-fee-bps <bps>', 'Taker fee in basis points', '30')
    .option('--slippage-bps <bps>', 'Slippage in basis points', '10')
    .option('--notional-usd <amount>', 'Position size in USD', '1000')
    .option(
      '--overlays <json>',
      'JSON array of exit overlays',
      '[{"kind":"take_profit","takePct":100}]'
    );

  defineCommand(exportSimCmd, {
    name: 'export-simulation',
    packageName: 'calls',
    coerce: (raw) => ({
      ...raw,
      duckdbPath: raw.duckdb,
      fromIso: raw.fromIso,
      toIso: raw.toIso,
      callerName: raw.callerName,
      limit: raw.limit ? coerceNumber(raw.limit, 'limit') : 1000,
      lagMs: raw.lagMs ? coerceNumber(raw.lagMs, 'lag-ms') : 10_000,
      timeframeMs: raw.timeframeMs
        ? coerceNumber(raw.timeframeMs, 'timeframe-ms')
        : 24 * 60 * 60 * 1000,
      takerFeeBps: raw.takerFeeBps ? coerceNumber(raw.takerFeeBps, 'taker-fee-bps') : 30,
      slippageBps: raw.slippageBps ? coerceNumber(raw.slippageBps, 'slippage-bps') : 10,
      notionalUsd: raw.notionalUsd ? coerceNumber(raw.notionalUsd, 'notional-usd') : 1000,
      overlays: raw.overlays ? coerceJson(raw.overlays, 'overlays') : undefined,
    }),
    validate: (opts) => exportCallsWithSimulationSchema.parse(opts),
    onError: die,
  });

  // Sweep command - using defineCommand wrapper
  const sweepCmd = callsCmd
    .command('sweep')
    .description('Run parameter sweep across intervals, lags, and overlay sets')
    .option('--config <path>', 'Path to config file (YAML/JSON) - can be used instead of CLI flags')
    .option('--calls-file <path>', 'Path to JSON file containing CallSignal[]')
    .option('--intervals <json>', 'JSON array of intervals: ["1m","5m"]')
    .option('--lags-ms <json>', 'JSON array of lag values in ms: [0,10000,30000,60000]')
    .option('--overlays-file <path>', 'Path to JSON file containing array of ExitOverlay arrays')
    .option(
      '--overlay-sets-file <path>',
      'Path to JSON file containing array of ExitOverlay arrays (same as overlays-file)'
    )
    .option('--out <dir>', 'Output directory (e.g., out/sweep-001/)')
    .option(
      '--entry-rule <rule>',
      'Entry rule: next_candle_open, next_candle_close, call_time_close',
      'next_candle_open'
    )
    .option('--timeframe-ms <ms>', 'Timeframe in milliseconds', String(24 * 60 * 60 * 1000))
    .option('--taker-fee-bps <bps>', 'Taker fee in basis points', '30')
    .option('--slippage-bps <bps>', 'Slippage in basis points', '10')
    .option('--notional-usd <amount>', 'Position size in USD', '1000')
    .option('--resume', 'Resume from previous run (skip completed scenarios)', false)
    .option('--format <format>', 'Output format', 'table');

  defineCommand(sweepCmd, {
    name: 'sweep',
    packageName: 'calls',
    coerce: (raw) => ({
      ...raw,
      // Coerce JSON strings to arrays (Commander gives camelCase keys)
      // coerceStringArray and coerceNumberArray handle both string and already-parsed values
      intervals: raw.intervals ? coerceStringArray(raw.intervals, 'intervals') : undefined,
      lagsMs: raw.lagsMs ? coerceNumberArray(raw.lagsMs, 'lags-ms') : undefined,
    }),
    validate: (opts) => sweepCallsSchema.parse(opts),
    onError: die,
  });
}

/**
 * Register as package command module
 */
const callsModule: PackageCommandModule = {
  packageName: 'calls',
  description: 'Call evaluation and backtesting operations',
  commands: [
    {
      name: 'evaluate',
      description: 'Evaluate calls with overlay-based backtesting',
      schema: evaluateCallsSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedArgs = args as z.infer<typeof evaluateCallsSchema>;
        const typedCtx = ctx as CommandContext;
        return await evaluateCallsHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot calls evaluate --calls-file calls.json --overlays \'[{"kind":"take_profit","takePct":100}]\'',
        'quantbot calls evaluate --calls-file calls.json --overlays \'[{"kind":"stop_loss","stopPct":20}]\' --lag-ms 30000',
      ],
    },
    {
      name: 'sweep',
      description: 'Run parameter sweep across intervals, lags, and overlay sets',
      schema: sweepCallsSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedArgs = args as z.infer<typeof sweepCallsSchema>;
        const typedCtx = ctx as CommandContext;
        return await sweepCallsHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot calls sweep --calls-file calls.json --intervals \'["1m","5m"]\' --lags-ms \'[0,10000,30000]\' --overlays-file overlays.json --out out/sweep-001/',
      ],
    },
    {
      name: 'export',
      description: 'Export calls from DuckDB to CallSignal JSON format',
      schema: exportCallsSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedArgs = args as z.infer<typeof exportCallsSchema>;
        const typedCtx = ctx as CommandContext;
        return await exportCallsFromDuckdbHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot calls export --duckdb data/tele.duckdb --from-iso 2024-01-01T00:00:00Z --to-iso 2024-01-02T00:00:00Z --out calls.json',
      ],
    },
    {
      name: 'export-simulation',
      description: 'Export calls from DuckDB with backtest results to CSV (deterministic replay)',
      schema: exportCallsWithSimulationSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedArgs = args as z.infer<typeof exportCallsWithSimulationSchema>;
        const typedCtx = ctx as CommandContext;
        return await exportCallsWithSimulationHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot calls export-simulation --duckdb data/tele.duckdb --from-iso 2025-11-02T00:00:00Z --to-iso 2025-12-20T23:59:59Z --out results.csv',
      ],
    },
  ],
};

// Register the module
commandRegistry.registerPackage(callsModule);
