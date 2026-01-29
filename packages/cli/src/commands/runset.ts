/**
 * RunSet Commands
 *
 * CLI commands for RunSet management (logical selections).
 * RunSets are declarative specs that reference sets of runs, not individual artifacts.
 *
 * @packageDocumentation
 */

import type { Command } from 'commander';
import { z } from 'zod';
import { defineCommand } from '../core/defineCommand.js';
import { die } from '../core/cliErrors.js';
import { commandRegistry } from '../core/command-registry.js';
import type { CommandContext } from '../core/command-context.js';
import type { PackageCommandModule } from '../types/index.js';

// RunSet schemas
import {
  createRunsetSchema,
  resolveRunsetSchema,
  freezeRunsetSchema,
  listRunsetsSchema,
  getRunsetSchema,
} from '../command-defs/runset.js';

// RunSet handlers
import { createRunsetHandler } from '../handlers/runset/create-runset.js';
import { resolveRunsetHandler } from '../handlers/runset/resolve-runset.js';
import { freezeRunsetHandler } from '../handlers/runset/freeze-runset.js';
import { listRunsetsHandler } from '../handlers/runset/list-runsets.js';
import { getRunsetHandler } from '../handlers/runset/get-runset.js';

/**
 * Register RunSet commands
 */
export function registerRunsetCommands(program: Command): void {
  const runsetCmd = program
    .command('runset')
    .description('RunSet management (logical selections, not data)');

  // Create RunSet
  const createCmd = runsetCmd
    .command('create')
    .description('Create a new RunSet with declarative selection spec')
    .option('--id <id>', 'RunSet ID (required)')
    .option('--name <name>', 'Human-readable name (required)')
    .option('--description <desc>', 'Optional description')
    .option('--dataset <dataset-id>', 'Dataset ID (required, e.g., ohlcv_v2_2025Q4)')
    .option('--caller <caller>', 'Filter by caller (optional)')
    .option('--chain <chain>', 'Filter by chain (optional)')
    .option('--venue <venue>', 'Filter by venue (optional)')
    .option('--min-market-cap <usd>', 'Minimum market cap (USD)')
    .option('--max-market-cap <usd>', 'Maximum market cap (USD)')
    .option('--min-volume <usd>', 'Minimum volume (USD)')
    .option('--from <date>', 'Start date (ISO 8601, required)')
    .option('--to <date>', 'End date (ISO 8601, required)')
    .option('--alert-window-policy <policy>', 'Alert window policy')
    .option('--strategy-family <family>', 'Strategy family filter')
    .option('--strategy-hash <hash>', 'Strategy hash filter')
    .option('--engine-version <version>', 'Engine version filter')
    .option('--tags <tags...>', 'Tags (optional)')
    .option('--latest', 'Use latest semantics (exploration mode)')
    .option('--auto-resolve', 'Auto-resolve after creation')
    .option('--format <format>', 'Output format (json|table)', 'table');

  defineCommand(createCmd, {
    name: 'create',
    packageName: 'runset',
    argsToOpts: (args, rawOpts) => ({
      ...rawOpts,
      minMarketCap: rawOpts['min-market-cap'] ? parseFloat(rawOpts['min-market-cap']) : undefined,
      maxMarketCap: rawOpts['max-market-cap'] ? parseFloat(rawOpts['max-market-cap']) : undefined,
      minVolume: rawOpts['min-volume'] ? parseFloat(rawOpts['min-volume']) : undefined,
      alertWindowPolicy: rawOpts['alert-window-policy'],
      strategyFamily: rawOpts['strategy-family'],
      strategyHash: rawOpts['strategy-hash'],
      engineVersion: rawOpts['engine-version'],
      autoResolve: rawOpts['auto-resolve'] || rawOpts.autoResolve,
    }),
    validate: (opts) => createRunsetSchema.parse(opts),
    onError: die,
  });

  // Resolve RunSet
  const resolveCmd = runsetCmd
    .command('resolve <runsetId>')
    .description('Resolve RunSet to concrete run_ids and artifacts')
    .option('--force', 'Force re-resolution even if cached/frozen')
    .option('--format <format>', 'Output format (json|table)', 'table');

  defineCommand(resolveCmd, {
    name: 'resolve',
    packageName: 'runset',
    argsToOpts: (args, rawOpts) => ({
      ...rawOpts,
      runsetId: args[0],
    }),
    validate: (opts) => resolveRunsetSchema.parse(opts),
    onError: die,
  });

  // Freeze RunSet
  const freezeCmd = runsetCmd
    .command('freeze <runsetId>')
    .description('Freeze RunSet (pin resolution for reproducibility)')
    .option('--format <format>', 'Output format (json|table)', 'table');

  defineCommand(freezeCmd, {
    name: 'freeze',
    packageName: 'runset',
    argsToOpts: (args, rawOpts) => ({
      ...rawOpts,
      runsetId: args[0],
    }),
    validate: (opts) => freezeRunsetSchema.parse(opts),
    onError: die,
  });

  // List RunSets
  const listCmd = runsetCmd
    .command('list')
    .description('List RunSets with optional filters')
    .option('--tags <tags...>', 'Filter by tags')
    .option('--dataset <dataset-id>', 'Filter by dataset ID')
    .option('--frozen', 'Filter by frozen status')
    .option('--mode <mode>', 'Filter by mode (exploration|reproducible)')
    .option('--limit <n>', 'Limit number of results', '100')
    .option('--format <format>', 'Output format (json|table|csv)', 'table');

  defineCommand(listCmd, {
    name: 'list',
    packageName: 'runset',
    validate: (opts) => listRunsetsSchema.parse(opts),
    onError: die,
  });

  // Get RunSet
  const getCmd = runsetCmd
    .command('get <runsetId>')
    .description('Get RunSet by ID')
    .option('--format <format>', 'Output format (json|table)', 'table');

  defineCommand(getCmd, {
    name: 'get',
    packageName: 'runset',
    argsToOpts: (args, rawOpts) => ({
      ...rawOpts,
      runsetId: args[0],
    }),
    validate: (opts) => getRunsetSchema.parse(opts),
    onError: die,
  });
}

/**
 * Register as package command module
 */
const runsetModule: PackageCommandModule = {
  packageName: 'runset',
  description: 'RunSet management (logical selections, not data)',
  commands: [
    {
      name: 'create',
      description: 'Create a new RunSet',
      schema: createRunsetSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof createRunsetSchema>;
        return await createRunsetHandler(typedArgs, ctx);
      },
      examples: [
        'quantbot runset create --id brook_baseline_2025Q4 --name "Brook Baseline Q4" --dataset ohlcv_v2_2025Q4 --caller whale_watcher --from 2025-10-01 --to 2025-12-31',
        'quantbot runset create --id momentum_test --name "Momentum Test" --dataset ohlcv_v2_2025Q4 --from 2025-10-01 --to 2025-12-31 --auto-resolve',
      ],
    },
    {
      name: 'resolve',
      description: 'Resolve RunSet to concrete run_ids',
      schema: resolveRunsetSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof resolveRunsetSchema>;
        return await resolveRunsetHandler(typedArgs, ctx);
      },
      examples: [
        'quantbot runset resolve brook_baseline_2025Q4',
        'quantbot runset resolve brook_baseline_2025Q4 --force',
      ],
    },
    {
      name: 'freeze',
      description: 'Freeze RunSet (pin for reproducibility)',
      schema: freezeRunsetSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof freezeRunsetSchema>;
        return await freezeRunsetHandler(typedArgs, ctx);
      },
      examples: ['quantbot runset freeze brook_baseline_2025Q4'],
    },
    {
      name: 'list',
      description: 'List RunSets',
      schema: listRunsetsSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof listRunsetsSchema>;
        return await listRunsetsHandler(typedArgs, ctx);
      },
      examples: [
        'quantbot runset list',
        'quantbot runset list --tags baseline --frozen',
        'quantbot runset list --dataset ohlcv_v2_2025Q4',
      ],
    },
    {
      name: 'get',
      description: 'Get RunSet by ID',
      schema: getRunsetSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof getRunsetSchema>;
        return await getRunsetHandler(typedArgs, ctx);
      },
      examples: ['quantbot runset get brook_baseline_2025Q4'],
    },
  ],
};

// Register the module
commandRegistry.registerPackage(runsetModule);

