/**
 * Simulation Commands
 */

import type { Command } from 'commander';
import { z } from 'zod';
import type { PackageCommandModule } from '../types/index.js';
import { commandRegistry } from '../core/command-registry.js';
import { execute } from '../core/execute.js';
import type { CommandContext } from '../core/command-context.js';
import { runSimulationHandler } from '../handlers/simulation/run-simulation.js';
import { listRunsHandler } from '../handlers/simulation/list-runs.js';
import { runSimulationDuckdbHandler } from '../handlers/simulation/run-simulation-duckdb.js';
import { runSchema, listRunsSchema, runSimulationDuckdbSchema } from '../command-defs/simulation.js';

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
      const commandDef = commandRegistry.getCommand('simulation', 'run');
      if (!commandDef) {
        throw new Error('Command simulation run not found in registry');
      }
      await execute(commandDef, {
        ...options,
        preWindow: options.preWindow ? parseInt(options.preWindow, 10) : 0,
        postWindow: options.postWindow ? parseInt(options.postWindow, 10) : 0,
        concurrency: options.concurrency ? parseInt(options.concurrency, 10) : 8,
        dryRun: options.dryRun === true || options.dryRun === 'true',
      });
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
      const commandDef = commandRegistry.getCommand('simulation', 'list-runs');
      if (!commandDef) {
        throw new Error('Command simulation list-runs not found in registry');
      }
      await execute(commandDef, {
        ...options,
        limit: options.limit ? parseInt(options.limit, 10) : 100,
      });
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
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof runSchema>;
        return await runSimulationHandler(typedArgs, ctx);
      },
      examples: [
        'quantbot simulation run --strategy PT2_SL25 --caller Brook --from 2024-01-01 --to 2024-02-01',
      ],
    },
    {
      name: 'list-runs',
      description: 'List simulation runs',
      schema: listRunsSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof listRunsSchema>;
        return await listRunsHandler(typedArgs, ctx);
      },
      examples: ['quantbot simulation list-runs --limit 50'],
    },
    {
      name: 'run-duckdb',
      description: 'Run simulation using DuckDB Python engine',
      schema: runSimulationDuckdbSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof runSimulationDuckdbSchema>;
        return await runSimulationDuckdbHandler(typedArgs, ctx);
      },
      examples: [
        'quantbot simulation run-duckdb --duckdb tele.duckdb --strategy strategy.json --mint So111...',
      ],
    },
  ],
};

// Register the module
commandRegistry.registerPackage(simulationModule);
