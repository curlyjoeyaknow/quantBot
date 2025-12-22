/**
 * Calls Commands
 */

import type { Command } from 'commander';
import { z } from 'zod';
import type { PackageCommandModule } from '../types/index.js';
import { commandRegistry } from '../core/command-registry.js';
import { execute } from '../core/execute.js';
import type { CommandContext } from '../core/command-context.js';
import { NotFoundError } from '@quantbot/utils';
import { evaluateCallsHandler } from './calls/evaluate-calls.js';
import { sweepCallsHandler } from './calls/sweep-calls.js';
import { exportCallsFromDuckdbHandler } from './calls/export-calls-from-duckdb.js';
import { evaluateCallsSchema, sweepCallsSchema, exportCallsSchema } from '../command-defs/calls.js';

/**
 * Register calls commands
 */
export function registerCallsCommands(program: Command): void {
  const callsCmd = program
    .command('calls')
    .description('Call evaluation and backtesting operations');

  // Evaluate command
  callsCmd
    .command('evaluate')
    .description('Evaluate calls with overlay-based backtesting')
    .requiredOption('--calls-file <path>', 'Path to JSON file containing CallSignal[]')
    .option('--lag-ms <ms>', 'Entry lag in milliseconds', '10000')
    .option('--entry-rule <rule>', 'Entry rule: next_candle_open, next_candle_close, call_time_close', 'next_candle_open')
    .option('--timeframe-ms <ms>', 'Timeframe in milliseconds', String(24 * 60 * 60 * 1000))
    .option('--interval <interval>', 'Candle interval: 1s, 1m, 5m, 1h', '5m')
    .option('--taker-fee-bps <bps>', 'Taker fee in basis points', '30')
    .option('--slippage-bps <bps>', 'Slippage in basis points', '10')
    .option('--overlays <json>', 'JSON array of exit overlays (required)')
    .option('--notional-usd <amount>', 'Position size in USD', '1000')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      const commandDef = commandRegistry.getCommand('calls', 'evaluate');
      if (!commandDef) {
        throw new NotFoundError('Command', 'calls.evaluate');
      }
      
      // Parse overlays JSON
      let overlays;
      if (options.overlays) {
        try {
          overlays = JSON.parse(options.overlays);
        } catch (error) {
          throw new Error(`Invalid overlays JSON: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        throw new Error('--overlays is required');
      }
      
      await execute(commandDef, {
        ...options,
        lagMs: options.lagMs ? parseInt(options.lagMs, 10) : 10_000,
        timeframeMs: options.timeframeMs ? parseInt(options.timeframeMs, 10) : 24 * 60 * 60 * 1000,
        takerFeeBps: options.takerFeeBps ? parseInt(options.takerFeeBps, 10) : 30,
        slippageBps: options.slippageBps ? parseInt(options.slippageBps, 10) : 10,
        notionalUsd: options.notionalUsd ? parseFloat(options.notionalUsd) : 1000,
        overlays,
      });
    });

  // Export command
  callsCmd
    .command('export')
    .description('Export calls from DuckDB to CallSignal JSON format')
    .requiredOption('--duckdb <path>', 'Path to DuckDB file')
    .requiredOption('--from-iso <iso>', 'Start date (ISO 8601)')
    .requiredOption('--to-iso <iso>', 'End date (ISO 8601)')
    .option('--caller-name <name>', 'Filter by caller name')
    .option('--limit <n>', 'Maximum calls to export', '200')
    .requiredOption('--out <path>', 'Output JSON file path')
    .option('--format <format>', 'Output format', 'json')
    .action(async (selectedOptions, command) => {
      const commandDef = commandRegistry.getCommand('calls', 'export');
      if (!commandDef) {
        throw new NotFoundError('Command', 'calls.export');
      }
      
      // Commander.js v12: use command.opts() to get all parsed options
      const opts = command.opts();
      
      // Debug: log what we received (remove after fixing)
      if (process.env.DEBUG_CLI_ARGS === 'true') {
        console.error('DEBUG: selectedOptions:', JSON.stringify(selectedOptions, null, 2));
        console.error('DEBUG: command.opts():', JSON.stringify(opts, null, 2));
        console.error('DEBUG: opts.duckdb:', opts.duckdb);
        console.error('DEBUG: opts.fromIso:', opts.fromIso);
        console.error('DEBUG: opts.toIso:', opts.toIso);
      }
      
      // Commander.js converts --from-iso to fromIso, --to-iso to toIso, --duckdb to duckdb
      // normalizeOptions will convert these to kebab-case, so we pass them directly
      // The schema now expects kebab-case field names to match normalizeOptions behavior
      const executeArgs: Record<string, unknown> = {
        'duckdb-path': opts.duckdb,
        'from-iso': opts.fromIso,
        'to-iso': opts.toIso,
        out: opts.out,
        format: opts.format || 'json',
      };
      
      if (opts.callerName) {
        executeArgs['caller-name'] = opts.callerName;
      }
      
      if (opts.limit) {
        executeArgs.limit = parseInt(String(opts.limit), 10);
      }
      
      await execute(commandDef, executeArgs);
    });

  // Sweep command
  callsCmd
    .command('sweep')
    .description('Run parameter sweep across intervals, lags, and overlay sets')
    .requiredOption('--calls-file <path>', 'Path to JSON file containing CallSignal[]')
    .requiredOption('--intervals <json>', 'JSON array of intervals: ["1m","5m"]')
    .requiredOption('--lags-ms <json>', 'JSON array of lag values in ms: [0,10000,30000,60000]')
    .option('--overlays-file <path>', 'Path to JSON file containing array of ExitOverlay arrays')
    .option('--overlay-sets-file <path>', 'Path to JSON file containing array of ExitOverlay arrays (same as overlays-file)')
    .requiredOption('--out <dir>', 'Output directory (e.g., out/sweep-001/)')
    .option('--entry-rule <rule>', 'Entry rule: next_candle_open, next_candle_close, call_time_close', 'next_candle_open')
    .option('--timeframe-ms <ms>', 'Timeframe in milliseconds', String(24 * 60 * 60 * 1000))
    .option('--taker-fee-bps <bps>', 'Taker fee in basis points', '30')
    .option('--slippage-bps <bps>', 'Slippage in basis points', '10')
    .option('--notional-usd <amount>', 'Position size in USD', '1000')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      const commandDef = commandRegistry.getCommand('calls', 'sweep');
      if (!commandDef) {
        throw new NotFoundError('Command', 'calls.sweep');
      }

      // Commander.js converts --calls-file to callsFile (camelCase)
      // normalizeOptions converts it back to kebab-case for schema validation
      // So we access the normalized values
      const callsFile = (options as any)['calls-file'] || (options as any).callsFile;
      const intervalsStr = (options as any).intervals;
      const lagsMsStr = (options as any)['lags-ms'] || (options as any).lagsMs;

      if (!callsFile) {
        throw new Error('--calls-file is required');
      }
      if (!intervalsStr) {
        throw new Error('--intervals is required');
      }
      if (!lagsMsStr) {
        throw new Error('--lags-ms is required');
      }

      // Parse intervals and lags JSON
      let intervals: string[];
      let lagsMs: number[];
      try {
        intervals = JSON.parse(intervalsStr);
        if (!Array.isArray(intervals)) {
          throw new Error('intervals must be a JSON array');
        }
      } catch (error) {
        throw new Error(`Invalid intervals JSON: ${error instanceof Error ? error.message : String(error)}`);
      }

      try {
        lagsMs = JSON.parse(lagsMsStr);
        if (!Array.isArray(lagsMs)) {
          throw new Error('lagsMs must be a JSON array');
        }
      } catch (error) {
        throw new Error(`Invalid lags-ms JSON: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Pass options with kebab-case keys (matching schema)
      await execute(commandDef, {
        'calls-file': callsFile as string,
        intervals,
        'lags-ms': lagsMs,
        'overlays-file': ((options as any)['overlays-file'] || (options as any).overlaysFile) as string | undefined,
        'overlay-sets-file': ((options as any)['overlay-sets-file'] || (options as any).overlaySetsFile) as string | undefined,
        out: (options as any).out as string,
        'entry-rule': ((options as any)['entry-rule'] || (options as any).entryRule || 'next_candle_open') as string,
        'timeframe-ms': ((options as any)['timeframe-ms'] || (options as any).timeframeMs) ? parseInt(((options as any)['timeframe-ms'] || (options as any).timeframeMs) as string, 10) : 24 * 60 * 60 * 1000,
        'taker-fee-bps': ((options as any)['taker-fee-bps'] || (options as any).takerFeeBps) ? parseInt(((options as any)['taker-fee-bps'] || (options as any).takerFeeBps) as string, 10) : 30,
        'slippage-bps': ((options as any)['slippage-bps'] || (options as any).slippageBps) ? parseInt(((options as any)['slippage-bps'] || (options as any).slippageBps) as string, 10) : 10,
        'notional-usd': ((options as any)['notional-usd'] || (options as any).notionalUsd) ? parseFloat(((options as any)['notional-usd'] || (options as any).notionalUsd) as string) : 1000,
        format: ((options as any).format || 'table') as string,
      });
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
  ],
};

// Register the module
commandRegistry.registerPackage(callsModule);

