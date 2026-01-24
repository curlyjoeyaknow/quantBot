/**
 * Raw Data Commands
 */

import type { Command } from 'commander';
import { z } from 'zod';
import { defineCommand } from '../../core/defineCommand.js';
import { die } from '../../core/cliErrors.js';
import { commandRegistry } from '../../core/command-registry.js';
import type { CommandContext } from '../../core/command-context.js';
import {
  rawDataListSchema,
  rawDataQuerySchema,
} from '../../command-defs/data.js';
import { listRawSourcesHandler } from '../../handlers/data/list-raw-sources.js';
import { queryRawDataHandler } from '../../handlers/data/query-raw-data.js';
import type { PackageCommandModule } from '../../types/index.js';

/**
 * Register raw data commands
 */
export function registerRawDataCommands(program: Command): void {
  const dataCmd = program
    .command('data')
    .description('Data operations');

  const rawCmd = dataCmd
    .command('raw')
    .description('Raw immutable data operations');

  // List sources
  const listCmd = rawCmd
    .command('list')
    .description('List all raw data sources')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(listCmd, {
    name: 'list',
    packageName: 'data',
    validate: (opts) => rawDataListSchema.parse(opts),
    onError: die,
  });

  // Query raw data
  const queryCmd = rawCmd
    .command('query')
    .description('Query raw data')
    .option('--from <date>', 'Start date (ISO 8601)')
    .option('--to <date>', 'End date (ISO 8601)')
    .option('--source-type <type>', 'Source type (telegram_export, api_response, etc.)')
    .option('--source-id <id>', 'Source identifier')
    .option('--hash <hash>', 'Content hash')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(queryCmd, {
    name: 'query',
    packageName: 'data',
    validate: (opts) => rawDataQuerySchema.parse(opts),
    onError: die,
  });
}

/**
 * Register as package command module
 */
const dataModule: PackageCommandModule = {
  packageName: 'data',
  description: 'Data operations',
  commands: [
    {
      name: 'raw list',
      description: 'List all raw data sources',
      schema: rawDataListSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof rawDataListSchema>;
        return await listRawSourcesHandler(typedArgs, ctx);
      },
      examples: [
        'quantbot data raw list',
        'quantbot data raw list --format json',
      ],
    },
    {
      name: 'raw query',
      description: 'Query raw data',
      schema: rawDataQuerySchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof rawDataQuerySchema>;
        return await queryRawDataHandler(typedArgs, ctx);
      },
      examples: [
        'quantbot data raw query --from 2024-01-01 --to 2024-01-02',
        'quantbot data raw query --source-type telegram_export',
      ],
    },
  ],
};

commandRegistry.registerPackage(dataModule);

