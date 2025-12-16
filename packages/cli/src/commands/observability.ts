/**
 * Observability Commands
 */

import type { Command } from 'commander';
import { z } from 'zod';
import { performHealthCheck } from '@quantbot/observability';
import { checkApiQuotas } from '@quantbot/observability';
import { commandRegistry } from '../core/command-registry.js';
import { parseArguments } from '../core/argument-parser.js';
import { formatOutput } from '../core/output-formatter.js';
import { handleError } from '../core/error-handler.js';
import type { PackageCommandModule } from '../types/index.js';

/**
 * Health command schema
 */
const healthSchema = z.object({
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * Quotas command schema
 */
const quotasSchema = z.object({
  service: z.enum(['birdeye', 'helius', 'all']).optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

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
      try {
        const args = parseArguments(healthSchema, options);
        const health = await performHealthCheck();

        // Format output
        const output = formatOutput(health, args.format);
        console.log(output);
      } catch (error) {
        const message = handleError(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });

  // Quotas command
  observabilityCmd
    .command('quotas')
    .description('Check API quota usage')
    .option('--service <service>', 'Service name (birdeye, helius, all)', 'all')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      try {
        const args = parseArguments(quotasSchema, options);
        const quotas = await checkApiQuotas();

        // Filter by service if specified
        const typedArgs = args as z.infer<typeof quotasSchema>;
        let outputData: unknown;
        if (typedArgs.service === 'all') {
          outputData = quotas;
        } else if (typedArgs.service) {
          outputData = { [typedArgs.service]: quotas[typedArgs.service as keyof typeof quotas] };
        } else {
          outputData = quotas;
        }

        // Format output
        const output = formatOutput(outputData, args.format);
        console.log(output);
      } catch (error) {
        const message = handleError(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
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
      try {
        const schema = z.object({
          from: z.string().optional(),
          to: z.string().optional(),
          limit: z.number().int().positive().max(10000).default(100),
          format: z.enum(['json', 'table', 'csv']).default('table'),
        });

        const args = parseArguments(schema, {
          ...options,
          limit: options.limit ? parseInt(options.limit, 10) : 100,
        });

        // Get error stats from observability package
        const { getErrorStats } = await import('@quantbot/observability');

        // Default to last 24 hours if no dates provided
        const to = args.to ? new Date(args.to) : new Date();
        const from = args.from ? new Date(args.from) : new Date(Date.now() - 24 * 60 * 60 * 1000);

        const stats = await getErrorStats({ from, to });

        const output = formatOutput(stats, args.format);
        console.log(output);
      } catch (error) {
        const message = handleError(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
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
      handler: async (args: unknown) => {
        const typedArgs = args as z.infer<typeof healthSchema>;
        return await performHealthCheck();
      },
      examples: ['quantbot observability health', 'quantbot observability health --format json'],
    },
    {
      name: 'quotas',
      description: 'Check API quota usage',
      schema: quotasSchema,
      handler: async (args: unknown) => {
        const typedArgs = args as z.infer<typeof quotasSchema>;
        const quotas = await checkApiQuotas();
        if (typedArgs.service && typedArgs.service !== 'all') {
          return { [typedArgs.service]: quotas[typedArgs.service as keyof typeof quotas] };
        }
        return quotas;
      },
      examples: [
        'quantbot observability quotas',
        'quantbot observability quotas --service birdeye',
      ],
    },
  ],
};

// Register the module
commandRegistry.registerPackage(observabilityModule);
