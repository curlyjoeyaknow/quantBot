/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Simulation Commands
 */

import type { Command } from 'commander';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { runSimulation, createProductionContext } from '@quantbot/workflows';
import type { SimulationRunSpec } from '@quantbot/workflows';
import { parseArguments } from '../core/argument-parser.js';
import { formatOutput } from '../core/output-formatter.js';
import { handleError } from '../core/error-handler.js';
import { ensureInitialized } from '../core/initialization-manager.js';
import type { PackageCommandModule } from '../types/index.js';
import { commandRegistry } from '../core/command-registry.js';

/**
 * Run command schema
 */
const runSchema = z.object({
  strategy: z.string().min(1),
  caller: z.string().optional(),
  from: z.string(),
  to: z.string(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * List runs schema
 */
const listRunsSchema = z.object({
  caller: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().positive().max(1000).default(100),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * Register simulation commands
 */
export function registerSimulationCommands(program: Command): void {
  const simCmd = program
    .command('simulation')
    .description('Trading strategy simulation operations');

  // Run command
  simCmd
    .command('run')
    .description('Run simulation on calls')
    .requiredOption('--strategy <name>', 'Strategy name')
    .option('--caller <name>', 'Caller name filter')
    .requiredOption('--from <date>', 'Start date (ISO 8601)')
    .requiredOption('--to <date>', 'End date (ISO 8601)')
    .option('--interval <interval>', 'Candle interval (1m, 5m, 15m, 1h)', '1m')
    .option('--pre-window <minutes>', 'Pre-window minutes', '0')
    .option('--post-window <minutes>', 'Post-window minutes', '0')
    .option('--dry-run', 'Do not persist results', false)
    .option('--concurrency <n>', 'Parallelism limit', '8')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      try {
        // Initialize storage
        await ensureInitialized();

        const extendedSchema = runSchema.extend({
          interval: z.enum(['1m', '5m', '15m', '1h']).default('1m'),
          preWindow: z.coerce.number().int().min(0).default(0),
          postWindow: z.coerce.number().int().min(0).default(0),
          dryRun: z.boolean().default(false),
          concurrency: z.coerce.number().int().min(1).max(64).default(8),
        });

        const args = parseArguments(extendedSchema, {
          ...options,
          preWindow: options.preWindow ? parseInt(options.preWindow, 10) : 0,
          postWindow: options.postWindow ? parseInt(options.postWindow, 10) : 0,
          concurrency: options.concurrency ? parseInt(options.concurrency, 10) : 8,
          dryRun: options.dryRun === true || options.dryRun === 'true',
        });

        // Build workflow spec
        const spec: SimulationRunSpec = {
          strategyName: args.strategy,
          callerName: args.caller,
          from: DateTime.fromISO(args.from, { zone: 'utc' }),
          to: DateTime.fromISO(args.to, { zone: 'utc' }),
          options: {
            preWindowMinutes: args.preWindow,
            postWindowMinutes: args.postWindow,
            dryRun: args.dryRun,
          },
        };

        // Create production context
        const ctx = createProductionContext();

        // Run workflow
        const result = await runSimulation(spec, ctx);

        // Format output
        const output = formatOutput(result, args.format);
        console.log(output);
      } catch (error) {
        const message = handleError(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });

  // List runs command
  simCmd
    .command('list-runs')
    .description('List simulation runs')
    .option('--caller <name>', 'Caller name filter')
    .option('--from <date>', 'Start date (ISO 8601)')
    .option('--to <date>', 'End date (ISO 8601)')
    .option('--limit <limit>', 'Maximum rows', '100')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      try {
        const args = parseArguments(listRunsSchema, {
          ...options,
          limit: options.limit ? parseInt(options.limit, 10) : 100,
        });

        const { SimulationRunsRepository } = await import('@quantbot/storage');
        const repo = new SimulationRunsRepository();

        // Query runs - just return empty for now as there's no list method
        const runs: any[] = [];

        const output = formatOutput(runs, args.format);
        console.log(output);
      } catch (error) {
        const message = handleError(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}

/**
 * Register as package command module
 */
const simulationModule: PackageCommandModule = {
  packageName: 'simulation',
  description: 'Trading strategy simulation operations',
  commands: [
    {
      name: 'run',
      description: 'Run simulation on calls',
      schema: runSchema,
      handler: async (args: unknown) => {
        // Handler for programmatic access - would need full context setup
        // For now, return a message indicating workflow usage
        return { message: 'Use CLI command for full workflow execution' };
      },
      examples: [
        'quantbot simulation run --strategy PT2_SL25 --caller Brook --from 2024-01-01 --to 2024-02-01',
      ],
    },
    {
      name: 'list-runs',
      description: 'List simulation runs',
      schema: listRunsSchema,
      handler: async (args: unknown) => {
        const typedArgs = args as z.infer<typeof listRunsSchema>;
        // Return empty for now - list method not implemented
        return [];
      },
      examples: ['quantbot simulation list-runs --limit 50'],
    },
  ],
};

// Register the module
commandRegistry.registerPackage(simulationModule);
