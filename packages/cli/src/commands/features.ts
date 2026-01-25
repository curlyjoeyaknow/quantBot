/**
 * Features Commands
 */

import type { Command } from 'commander';
import { z } from 'zod';
import { defineCommand } from '../core/defineCommand.js';
import { die } from '../core/cliErrors.js';
import { commandRegistry } from '../core/command-registry.js';
import type { PackageCommandModule } from '../types/index.js';
import type { CommandContext } from '../core/command-context.js';
import { featuresListSchema, featuresComputeSchema } from '../command-defs/features.js';
import { listFeaturesHandler } from '../handlers/features/list-features.js';
import { computeFeaturesHandler } from '../handlers/features/compute-features.js';

/**
 * Register features commands
 */
export function registerFeaturesCommands(program: Command): void {
  const featuresCmd = program
    .command('features')
    .description('Feature store operations');

  // List features
  const listCmd = featuresCmd
    .command('list')
    .description('List all registered features')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(listCmd, {
    name: 'list',
    packageName: 'features',
    validate: (opts) => featuresListSchema.parse(opts),
    onError: die,
  });

  // Compute features
  const computeCmd = featuresCmd
    .command('compute')
    .description('Compute features for a feature set')
    .requiredOption('--feature-set <id>', 'Feature set ID')
    .option('--from <date>', 'Start date (ISO 8601)')
    .option('--to <date>', 'End date (ISO 8601)')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(computeCmd, {
    name: 'compute',
    packageName: 'features',
    validate: (opts) => featuresComputeSchema.parse(opts),
    onError: die,
  });
}

/**
 * Register as package command module
 */
const featuresModule: PackageCommandModule = {
  packageName: 'features',
  description: 'Feature store operations',
  commands: [
    {
      name: 'list',
      description: 'List all registered features',
      schema: featuresListSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof featuresListSchema>;
        return await listFeaturesHandler(typedArgs, ctx);
      },
      examples: [
        'quantbot features list',
        'quantbot features list --format json',
      ],
    },
    {
      name: 'compute',
      description: 'Compute features for a feature set',
      schema: featuresComputeSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof featuresComputeSchema>;
        return await computeFeaturesHandler(typedArgs, ctx);
      },
      examples: [
        'quantbot features compute --feature-set rsi:1.0.0',
        'quantbot features compute --feature-set rsi:1.0.0 --from 2024-01-01 --to 2024-12-31',
      ],
    },
  ],
};

commandRegistry.registerPackage(featuresModule);

