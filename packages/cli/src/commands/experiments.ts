/**
 * Experiment Commands
 */

import type { Command } from 'commander';
import { z } from 'zod';
import { defineCommand } from '../core/defineCommand.js';
import { die } from '../core/cliErrors.js';
import { commandRegistry } from '../core/command-registry.js';
import type { CommandContext } from '../core/command-context.js';
import {
  listExperimentsSchema,
  getExperimentSchema,
  findExperimentsByParameterSchema,
} from '../command-defs/experiments.js';
import { listExperimentsHandler } from '../handlers/experiments/list-experiments.js';
import { getExperimentHandler } from '../handlers/experiments/get-experiment.js';
import { findExperimentsByParameterHandler } from '../handlers/experiments/find-by-parameter.js';
import type { PackageCommandModule } from '../types/index.js';

/**
 * Register experiment commands
 */
export function registerExperimentsCommands(program: Command): void {
  const experimentsCmd = program
    .command('experiments')
    .description('Query and manage experiments');

  // List experiments
  const listCmd = experimentsCmd
    .command('list')
    .description('List experiments with optional filters')
    .option('--experiment-id <id>', 'Filter by experiment ID')
    .option('--strategy-id <id>', 'Filter by strategy ID')
    .option('--parameter-hash <hash>', 'Filter by parameter vector hash')
    .option('--git-commit <hash>', 'Filter by git commit hash')
    .option('--data-snapshot <hash>', 'Filter by data snapshot hash')
    .option('--status <status>', 'Filter by status (pending|running|completed|failed)')
    .option('--started-after <date>', 'Filter by started after date (ISO string)')
    .option('--started-before <date>', 'Filter by started before date (ISO string)')
    .option('--limit <number>', 'Limit number of results')
    .option('--offset <number>', 'Offset for pagination')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(listCmd, {
    name: 'list',
    packageName: 'experiments',
    validate: (opts) => listExperimentsSchema.parse(opts),
    onError: die,
  });

  // Get experiment
  const getCmd = experimentsCmd
    .command('get <experimentId>')
    .description('Get experiment by ID')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(getCmd, {
    name: 'get',
    packageName: 'experiments',
    argsToOpts: (args, rawOpts) => ({
      ...rawOpts,
      experimentId: args[0],
    }),
    validate: (opts) => getExperimentSchema.parse(opts),
    onError: die,
  });

  // Find by parameter hash
  const findCmd = experimentsCmd
    .command('find')
    .description('Find experiments by parameter hash')
    .option('--parameter-hash <hash>', 'Parameter vector hash (required)', '')
    .option('--limit <number>', 'Limit number of results')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(findCmd, {
    name: 'find',
    packageName: 'experiments',
    validate: (opts) => {
      if (!opts.parameterHash) {
        throw new Error('--parameter-hash is required');
      }
      return findExperimentsByParameterSchema.parse(opts);
    },
    onError: die,
  });
}

/**
 * Register as package command module
 */
const experimentsModule: PackageCommandModule = {
  packageName: 'experiments',
  description: 'Query and manage experiments',
  commands: [
    {
      name: 'list',
      description: 'List experiments with optional filters',
      schema: listExperimentsSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof listExperimentsSchema>;
        return await listExperimentsHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot experiments list',
        'quantbot experiments list --status completed --limit 10',
        'quantbot experiments list --parameter-hash abc123 --format json',
      ],
    },
    {
      name: 'get',
      description: 'Get experiment by ID',
      schema: getExperimentSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof getExperimentSchema>;
        return await getExperimentHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot experiments get exp-20240101120000-abc123',
        'quantbot experiments get exp-20240101120000-abc123 --format json',
      ],
    },
    {
      name: 'find',
      description: 'Find experiments by parameter hash',
      schema: findExperimentsByParameterSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof findExperimentsByParameterSchema>;
        return await findExperimentsByParameterHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot experiments find --parameter-hash abc123',
        'quantbot experiments find --parameter-hash abc123 --limit 5',
      ],
    },
  ],
};

// Register the module
commandRegistry.registerPackage(experimentsModule);

