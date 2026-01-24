/**
 * Features Commands
 */

import type { Command } from 'commander';
import { defineCommand } from '../core/defineCommand.js';
import { die } from '../core/cliErrors.js';
import { commandRegistry } from '../core/command-registry.js';
import type { PackageCommandModule } from '../types/index.js';
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
    handler: listFeaturesHandler,
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
    handler: computeFeaturesHandler,
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
      handler: listFeaturesHandler,
      examples: [
        'quantbot features list',
        'quantbot features list --format json',
      ],
    },
    {
      name: 'compute',
      description: 'Compute features for a feature set',
      schema: featuresComputeSchema,
      handler: computeFeaturesHandler,
      examples: [
        'quantbot features compute --feature-set rsi:1.0.0',
        'quantbot features compute --feature-set rsi:1.0.0 --from 2024-01-01 --to 2024-12-31',
      ],
    },
  ],
};

commandRegistry.registerPackage(featuresModule);

