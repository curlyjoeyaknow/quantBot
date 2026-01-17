/**
 * Data commands - feature store versioning and hash tracking
 */

import { Command } from 'commander';
import { defineCommand } from '../core/defineCommand.js';
import {
  dataFeatureStoreVersionSchema,
  dataFeatureStoreListVersionsSchema,
  dataCheckHashSchema,
  type DataFeatureStoreVersionArgs,
  type DataFeatureStoreListVersionsArgs,
  type DataCheckHashArgs,
} from '../command-defs/data.js';
import { featureStoreVersionHandler } from '../handlers/data/feature-store-version.js';
import { featureStoreListVersionsHandler } from '../handlers/data/feature-store-list-versions.js';
import { checkHashHandler } from '../handlers/data/check-hash.js';
import type { PackageCommandModule } from '../types/index.js';
import type { CommandContext } from '../core/command-context.js';
import { commandRegistry } from '../core/command-registry.js';

/**
 * Register data commands
 */
export function registerDataCommands(program: Command): void {
  const dataCmd = program
    .command('data')
    .description('Data management - feature store versioning and hash tracking');

  // Feature store version command
  const versionCmd = dataCmd
    .command('feature-store-version')
    .description('Get version information for a feature set')
    .requiredOption('--feature-set-id <id>', 'Feature set ID')
    .option('--format <format>', 'Output format (json|table)', 'table');

  defineCommand(versionCmd, {
    name: 'feature-store-version',
    packageName: 'data',
    coerce: (raw: Record<string, unknown>) => ({
      featureSetId: raw.featureSetId as string,
      format: raw.format || 'table',
    }),
    validate: (opts: Record<string, unknown>) => dataFeatureStoreVersionSchema.parse(opts),
    onError: (error: unknown) => {
      console.error('Error getting feature store version:', error);
      process.exit(1);
    },
  });

  // Feature store list-versions command
  const listVersionsCmd = dataCmd
    .command('feature-store-list-versions')
    .description('List all feature sets with version information')
    .option('--format <format>', 'Output format (json|table)', 'table');

  defineCommand(listVersionsCmd, {
    name: 'feature-store-list-versions',
    packageName: 'data',
    coerce: (raw: Record<string, unknown>) => ({
      format: raw.format || 'table',
    }),
    validate: (opts: Record<string, unknown>) => dataFeatureStoreListVersionsSchema.parse(opts),
    onError: (error: unknown) => {
      console.error('Error listing feature store versions:', error);
      process.exit(1);
    },
  });

  // Check hash command
  const checkHashCmd = dataCmd
    .command('check-hash')
    .description('Check if a raw data hash exists (for idempotency)')
    .requiredOption('--hash <hash>', 'Hash to check')
    .option('--format <format>', 'Output format (json|table)', 'table');

  defineCommand(checkHashCmd, {
    name: 'check-hash',
    packageName: 'data',
    coerce: (raw: Record<string, unknown>) => ({
      hash: raw.hash as string,
      format: raw.format || 'table',
    }),
    validate: (opts: Record<string, unknown>) => dataCheckHashSchema.parse(opts),
    onError: (error: unknown) => {
      console.error('Error checking hash:', error);
      process.exit(1);
    },
  });
}

/**
 * Register as package command module
 */
const dataModule: PackageCommandModule = {
  packageName: 'data',
  description: 'Data management - feature store versioning and hash tracking',
  commands: [
    {
      name: 'feature-store-version',
      description: 'Get version information for a feature set',
      schema: dataFeatureStoreVersionSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedArgs = args as DataFeatureStoreVersionArgs;
        const typedCtx = ctx as CommandContext;
        return await featureStoreVersionHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot data feature-store-version --feature-set-id <id>',
        'quantbot data feature-store-version --feature-set-id <id> --format json',
      ],
    },
    {
      name: 'feature-store-list-versions',
      description: 'List all feature sets with version information',
      schema: dataFeatureStoreListVersionsSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedArgs = args as DataFeatureStoreListVersionsArgs;
        const typedCtx = ctx as CommandContext;
        return await featureStoreListVersionsHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot data feature-store-list-versions',
        'quantbot data feature-store-list-versions --format json',
      ],
    },
    {
      name: 'check-hash',
      description: 'Check if a raw data hash exists (for idempotency)',
      schema: dataCheckHashSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedArgs = args as DataCheckHashArgs;
        const typedCtx = ctx as CommandContext;
        return await checkHashHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot data check-hash --hash <hash>',
        'quantbot data check-hash --hash <hash> --format json',
      ],
    },
  ],
};

commandRegistry.registerPackage(dataModule);

export default dataModule;
