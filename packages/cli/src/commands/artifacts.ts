/**
 * Artifact Commands
 */

import type { Command } from 'commander';
import { z } from 'zod';
import { defineCommand } from '../core/defineCommand.js';
import { die } from '../core/cliErrors.js';
import { commandRegistry } from '../core/command-registry.js';
import type { CommandContext } from '../core/command-context.js';
import {
  artifactsListSchema,
  artifactsGetSchema,
  artifactsTagSchema,
} from '../command-defs/artifacts.js';
import { listArtifactsHandler } from '../handlers/artifacts/list-artifacts.js';
import { getArtifactHandler } from '../handlers/artifacts/get-artifact.js';
import { tagArtifactHandler } from '../handlers/artifacts/tag-artifact.js';
import type { PackageCommandModule } from '../types/index.js';

/**
 * Register artifact commands
 */
export function registerArtifactCommands(program: Command): void {
  const artifactsCmd = program
    .command('artifacts')
    .description('Manage versioned artifacts (strategies, sim runs, configs)');

  // List artifacts
  const listCmd = artifactsCmd
    .command('list')
    .description('List all artifacts')
    .option('--type <type>', 'Filter by artifact type')
    .option('--tags <tags...>', 'Filter by tags')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(listCmd, {
    name: 'list',
    packageName: 'artifacts',
    validate: (opts) => artifactsListSchema.parse(opts),
    onError: die,
  });

  // Get artifact
  const getCmd = artifactsCmd
    .command('get <id>')
    .description('Get artifact by ID and version')
    .option('--version <version>', 'Artifact version (default: latest)')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(getCmd, {
    name: 'get',
    packageName: 'artifacts',
    argsToOpts: (args, rawOpts) => ({
      ...rawOpts,
      id: args[0],
    }),
    validate: (opts) => artifactsGetSchema.parse(opts),
    onError: die,
  });

  // Tag artifact
  const tagCmd = artifactsCmd
    .command('tag <id> <version> <tags...>')
    .description('Tag an artifact');

  defineCommand(tagCmd, {
    name: 'tag',
    packageName: 'artifacts',
    argsToOpts: (args, rawOpts) => ({
      ...rawOpts,
      id: args[0],
      version: args[1],
      tags: args.slice(2) as string[],
    }),
    validate: (opts) => artifactsTagSchema.parse(opts),
    onError: die,
  });
}

/**
 * Register as package command module
 */
const artifactsModule: PackageCommandModule = {
  packageName: 'artifacts',
  description: 'Manage versioned artifacts (strategies, sim runs, configs)',
  commands: [
    {
      name: 'list',
      description: 'List all artifacts',
      schema: artifactsListSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof artifactsListSchema>;
        return await listArtifactsHandler(typedArgs, ctx);
      },
      examples: [
        'quantbot artifacts list',
        'quantbot artifacts list --type strategy',
        'quantbot artifacts list --tags production,tested',
      ],
    },
    {
      name: 'get',
      description: 'Get artifact by ID and version',
      schema: artifactsGetSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof artifactsGetSchema>;
        return await getArtifactHandler(typedArgs, ctx);
      },
      examples: [
        'quantbot artifacts get strategy-123',
        'quantbot artifacts get strategy-123 --version 2.0.0',
      ],
    },
    {
      name: 'tag',
      description: 'Tag an artifact',
      schema: artifactsTagSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof artifactsTagSchema>;
        return await tagArtifactHandler(typedArgs, ctx);
      },
      examples: ['quantbot artifacts tag strategy-123 2.0.0 production tested'],
    },
  ],
};

commandRegistry.registerPackage(artifactsModule);
