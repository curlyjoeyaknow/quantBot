/**
 * Observability Commands
 */

import type { Command } from 'commander';
import { z } from 'zod';
import { commandRegistry } from '../core/command-registry.js';
import { defineCommand } from '../core/defineCommand.js';
import { die } from '../core/cliErrors.js';
import { coerceNumber } from '../core/coerce.js';
import type { CommandContext } from '../core/command-context.js';
import { healthObservabilityHandler } from './observability/health-observability.js';
import { quotasObservabilityHandler } from './observability/quotas-observability.js';
import { errorsObservabilityHandler } from './observability/errors-observability.js';
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
  const healthCmd = observabilityCmd
    .command('health')
    .description('Check system health (databases, APIs)')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(healthCmd, {
    name: 'health',
    packageName: 'observability',
    validate: (opts) => healthSchema.parse(opts),
    onError: die,
  });

  // Quotas command
  const quotasCmd = observabilityCmd
    .command('quotas')
    .description('Check API quota usage')
    .option('--service <service>', 'Service name (birdeye, helius, all)', 'all')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(quotasCmd, {
    name: 'quotas',
    packageName: 'observability',
    validate: (opts) => quotasSchema.parse(opts),
    onError: die,
  });

  // Errors command
  const errorsCmd = observabilityCmd
    .command('errors')
    .description('View error statistics')
    .option('--from <date>', 'Start date (ISO 8601)')
    .option('--to <date>', 'End date (ISO 8601)')
    .option('--limit <limit>', 'Maximum rows')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(errorsCmd, {
    name: 'errors',
    packageName: 'observability',
    coerce: (raw) => ({
      ...raw,
      limit: raw.limit ? coerceNumber(raw.limit, 'limit') : 100,
    }),
    validate: (opts) => errorsSchema.parse(opts),
    onError: die,
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
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof healthSchema>;
        return await healthObservabilityHandler(typedArgs, typedCtx);
      },
      examples: ['quantbot observability health', 'quantbot observability health --format json'],
    },
    {
      name: 'quotas',
      description: 'Check API quota usage',
      schema: quotasSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof quotasSchema>;
        return await quotasObservabilityHandler(typedArgs, typedCtx);
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
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof errorsSchema>;
        return await errorsObservabilityHandler(typedArgs, typedCtx);
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
