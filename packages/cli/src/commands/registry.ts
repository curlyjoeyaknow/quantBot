/**
 * Registry Commands
 *
 * CLI commands for registry management (Parquet-first metadata store).
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

// Registry schemas
import { registryRebuildSchema } from '../command-defs/registry.js';

// Registry handlers
import { registryRebuildHandler } from '../handlers/registry/rebuild.js';

/**
 * Register registry commands
 */
export function registerRegistryCommands(program: Command): void {
  const registryCmd = program
    .command('registry')
    .description('Registry management (Parquet-first metadata store)');

  // Rebuild registry
  const rebuildCmd = registryCmd
    .command('rebuild')
    .description('Rebuild DuckDB registry from Parquet truth')
    .option('--force', 'Force rebuild even if DuckDB exists')
    .option('--format <format>', 'Output format (json|table)', 'table');

  defineCommand(rebuildCmd, {
    name: 'rebuild',
    packageName: 'registry',
    validate: (opts) => registryRebuildSchema.parse(opts),
    onError: die,
  });
}

/**
 * Register as package command module
 */
const registryModule: PackageCommandModule = {
  packageName: 'registry',
  description: 'Registry management (Parquet-first metadata store)',
  commands: [
    {
      name: 'rebuild',
      description: 'Rebuild DuckDB registry from Parquet truth',
      schema: registryRebuildSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof registryRebuildSchema>;
        return await registryRebuildHandler(typedArgs, ctx);
      },
      examples: [
        'quantbot registry rebuild',
        'quantbot registry rebuild --force',
        'quantbot registry rebuild --format json',
      ],
    },
  ],
};

// Register the module
commandRegistry.registerPackage(registryModule);

