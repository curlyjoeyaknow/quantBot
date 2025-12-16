/**
 * Observability Commands
 */

import type { Command } from 'commander';
import { z } from 'zod';
import { commandRegistry } from '../core/command-registry.js';
import { execute } from '../core/execute.js';
import type { CommandContext } from '../core/command-context.js';
import { healthObservabilityHandler } from '../handlers/observability/health-observability.js';
import { quotasObservabilityHandler } from '../handlers/observability/quotas-observability.js';
import { errorsObservabilityHandler } from '../handlers/observability/errors-observability.js';
import { healthSchema, quotasSchema, errorsSchema } from '../command-defs/observability.js';
import type { PackageCommandModule } from '../types/index.js';

/**
 * Register observability commands
 */
export function registerObservabilityCommands(program: Command): void {
  const observabilityCmd = program
    .command('observability')
    .description('System observability and health checks');

  // Health command
  observabilityCmd
    .command('health')
    .description('Check system health (databases, APIs)')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      const commandDef = commandRegistry.getCommand('observability', 'health');
      if (!commandDef) {
        throw new Error('Command observability health not found in registry');
      }
      await execute(commandDef, options);
    });

  // Quotas command
  observabilityCmd
    .command('quotas')
    .description('Check API quota usage')
    .option('--service <service>', 'Service name (birdeye, helius, all)', 'all')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      const commandDef = commandRegistry.getCommand('observability', 'quotas');
      if (!commandDef) {
        throw new Error('Command observability quotas not found in registry');
      }
      await execute(commandDef, options);
    });

  // Errors command
  observabilityCmd
    .command('errors')
    .description('View error statistics')
    .option('--from <date>', 'Start date (ISO 8601)')
    .option('--to <date>', 'End date (ISO 8601)')
    .option('--limit <limit>', 'Maximum rows', '100')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      const commandDef = commandRegistry.getCommand('observability', 'errors');
      if (!commandDef) {
        throw new Error('Command observability errors not found in registry');
      }
      await execute(commandDef, {
        ...options,
        limit: options.limit ? parseInt(options.limit, 10) : 100,
      });
    });
}

/**
 * Register as package command module
 */
const observabilityModule: PackageCommandModule = {
  packageName: 'observability',
  description: 'System observability and health checks',
  commands: [
    {
      name: 'health',
      description: 'Check system health (databases, APIs)',
      schema: healthSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof healthSchema>;
        return await healthObservabilityHandler(typedArgs, ctx);
      },
      examples: ['quantbot observability health', 'quantbot observability health --format json'],
    },
    {
      name: 'quotas',
      description: 'Check API quota usage',
      schema: quotasSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof quotasSchema>;
        return await quotasObservabilityHandler(typedArgs, ctx);
      },
      examples: [
        'quantbot observability quotas',
        'quantbot observability quotas --service birdeye',
      ],
    },
    {
      name: 'errors',
      description: 'View error statistics',
      schema: errorsSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof errorsSchema>;
        return await errorsObservabilityHandler(typedArgs, ctx);
      },
      examples: [
        'quantbot observability errors',
        'quantbot observability errors --from 2024-01-01 --to 2024-01-31',
      ],
    },
  ],
};

// Register the module
commandRegistry.registerPackage(observabilityModule);
