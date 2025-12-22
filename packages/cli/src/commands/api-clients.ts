/**
 * API Clients Commands
 */

import type { Command } from 'commander';
import { z } from 'zod';
import type { PackageCommandModule } from '../types/index.js';
import { defineCommand } from '../core/defineCommand.js';
import { die } from '../core/cliErrors.js';
import type { CommandContext } from '../core/command-context.js';
import { commandRegistry } from '../core/command-registry.js';
import { testApiClientsHandler } from './api-clients/test-api-clients.js';
import { statusApiClientsHandler } from './api-clients/status-api-clients.js';
import { creditsApiClientsHandler } from './api-clients/credits-api-clients.js';
import { testSchema, statusSchema, creditsSchema } from '../command-defs/api-clients.js';

/**
 * Register API clients commands
 */
export function registerApiClientsCommands(program: Command): void {
  const apiCmd = program.command('api-clients').description('API client operations and testing');

  // Test command
  const testCmd = apiCmd
    .command('test')
    .description('Test API connection')
    .requiredOption('--service <service>', 'Service name (birdeye, helius)')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(testCmd, {
    name: 'test',
    packageName: 'api-clients',
    validate: (opts) => testSchema.parse(opts),
    onError: die,
  });

  // Status command
  const statusCmd = apiCmd
    .command('status')
    .description('Check API status')
    .option('--service <service>', 'Service name', 'all')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(statusCmd, {
    name: 'status',
    packageName: 'api-clients',
    validate: (opts) => statusSchema.parse(opts),
    onError: die,
  });

  // Credits command
  const creditsCmd = apiCmd
    .command('credits')
    .description('Check API credits/quota')
    .option('--service <service>', 'Service name', 'all')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(creditsCmd, {
    name: 'credits',
    packageName: 'api-clients',
    validate: (opts) => creditsSchema.parse(opts),
    onError: die,
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
