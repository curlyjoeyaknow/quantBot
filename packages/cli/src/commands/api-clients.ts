/**
 * API Clients Commands
 */

import type { Command } from 'commander';
import { z } from 'zod';
import type { PackageCommandModule } from '../types/index.js';
import { commandRegistry } from '../core/command-registry.js';
import { execute } from '../core/execute.js';
import type { CommandContext } from '../core/command-context.js';
import { NotFoundError } from '@quantbot/utils';
import { testApiClientsHandler } from '../handlers/api-clients/test-api-clients.js';
import { statusApiClientsHandler } from '../handlers/api-clients/status-api-clients.js';
import { creditsApiClientsHandler } from '../handlers/api-clients/credits-api-clients.js';
import { testSchema, statusSchema, creditsSchema } from '../command-defs/api-clients.js';

/**
 * Register API clients commands
 */
export function registerApiClientsCommands(program: Command): void {
  const apiCmd = program.command('api-clients').description('API client operations and testing');

  // Test command
  apiCmd
    .command('test')
    .description('Test API connection')
    .requiredOption('--service <service>', 'Service name (birdeye, helius)')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      const commandDef = commandRegistry.getCommand('api-clients', 'test');
      if (!commandDef) {
        throw new NotFoundError('Command', 'api-clients.test');
      }
      await execute(commandDef, options);
    });

  // Status command
  apiCmd
    .command('status')
    .description('Check API status')
    .option('--service <service>', 'Service name', 'all')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      const commandDef = commandRegistry.getCommand('api-clients', 'status');
      if (!commandDef) {
        throw new NotFoundError('Command', 'api-clients.status');
      }
      await execute(commandDef, options);
    });

  // Credits command
  apiCmd
    .command('credits')
    .description('Check API credits/quota')
    .option('--service <service>', 'Service name', 'all')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      const commandDef = commandRegistry.getCommand('api-clients', 'credits');
      if (!commandDef) {
        throw new NotFoundError('Command', 'api-clients.credits');
      }
      await execute(commandDef, options);
    });
}

/**
 * Register as package command module
 */
const apiClientsModule: PackageCommandModule = {
  packageName: 'api-clients',
  description: 'API client operations and testing',
  commands: [
    {
      name: 'test',
      description: 'Test API connection',
      schema: testSchema,
      handler: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof testSchema>;
        return await testApiClientsHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot api-clients test --service birdeye',
        'quantbot api-clients test --service helius',
      ],
    },
    {
      name: 'status',
      description: 'Check API status',
      schema: statusSchema,
      handler: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof statusSchema>;
        return await statusApiClientsHandler(typedArgs, typedCtx);
      },
      examples: ['quantbot api-clients status'],
    },
    {
      name: 'credits',
      description: 'Check API credits/quota',
      schema: creditsSchema,
      handler: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof creditsSchema>;
        return await creditsApiClientsHandler(typedArgs, typedCtx);
      },
      examples: ['quantbot api-clients credits --service birdeye'],
    },
  ],
};

// Register the module
commandRegistry.registerPackage(apiClientsModule);
