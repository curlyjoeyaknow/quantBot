/**
 * Analytics Commands
 */

import type { Command } from 'commander';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { AnalyticsEngine, getAnalyticsEngine } from '@quantbot/analytics';
import { parseArguments } from '../core/argument-parser';
import { formatOutput } from '../core/output-formatter';
import { handleError } from '../core/error-handler';
import type { PackageCommandModule } from '../types';
import { commandRegistry } from '../core/command-registry';

/**
 * Analyze command schema
 */
const analyzeSchema = z.object({
  caller: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * Metrics command schema
 */
const metricsSchema = z.object({
  caller: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * Report command schema
 */
const reportSchema = z.object({
  caller: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * Register analytics commands
 */
export function registerAnalyticsCommands(program: Command): void {
  const analyticsCmd = program
    .command('analytics')
    .description('Analytics and performance metrics');

  // Analyze command
  analyticsCmd
    .command('analyze')
    .description('Analyze calls with metrics')
    .option('--caller <name>', 'Caller name filter')
    .option('--from <date>', 'Start date (ISO 8601)')
    .option('--to <date>', 'End date (ISO 8601)')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      try {
        const args = parseArguments(analyzeSchema, options);

        const engine = getAnalyticsEngine();
        const result = await engine.analyzeCalls({
          callerNames: args.caller ? [args.caller] : undefined,
          from: args.from ? DateTime.fromISO(args.from).toJSDate() : undefined,
          to: args.to ? DateTime.fromISO(args.to).toJSDate() : undefined,
        });

        const output = formatOutput(result, args.format);
        console.log(output);
      } catch (error) {
        const message = handleError(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });

  // Metrics command
  analyticsCmd
    .command('metrics')
    .description('Calculate period metrics')
    .option('--caller <name>', 'Caller name filter')
    .option('--from <date>', 'Start date (ISO 8601)')
    .option('--to <date>', 'End date (ISO 8601)')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      try {
        const args = parseArguments(metricsSchema, options);
        const result = {
          message: 'Metrics calculation - implementation in progress',
        };
        const output = formatOutput(result, args.format);
        console.log(output);
      } catch (error) {
        const message = handleError(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });

  // Report command
  analyticsCmd
    .command('report')
    .description('Generate analytics report')
    .option('--caller <name>', 'Caller name filter')
    .option('--from <date>', 'Start date (ISO 8601)')
    .option('--to <date>', 'End date (ISO 8601)')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      try {
        const args = parseArguments(reportSchema, options);
        const result = {
          message: 'Report generation - implementation in progress',
        };
        const output = formatOutput(result, args.format);
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
const analyticsModule: PackageCommandModule = {
  packageName: 'analytics',
  description: 'Analytics and performance metrics',
  commands: [
    {
      name: 'analyze',
      description: 'Analyze calls with metrics',
      schema: analyzeSchema,
      handler: async (args: unknown) => {
        const typedArgs = args as z.infer<typeof analyzeSchema>;
        const engine = getAnalyticsEngine();
        return await engine.analyzeCalls({
          callerNames: typedArgs.caller ? [typedArgs.caller] : undefined,
          from: typedArgs.from ? DateTime.fromISO(typedArgs.from).toJSDate() : undefined,
          to: typedArgs.to ? DateTime.fromISO(typedArgs.to).toJSDate() : undefined,
        });
      },
      examples: ['quantbot analytics analyze --caller Brook --from 2024-01-01 --to 2024-02-01'],
    },
    {
      name: 'metrics',
      description: 'Calculate period metrics',
      schema: metricsSchema,
      handler: async () => ({ message: 'Metrics calculation' }),
      examples: ['quantbot analytics metrics --caller Brook'],
    },
    {
      name: 'report',
      description: 'Generate analytics report',
      schema: reportSchema,
      handler: async () => ({ message: 'Report generation' }),
      examples: ['quantbot analytics report --caller Brook'],
    },
  ],
};

// Register the module
commandRegistry.registerPackage(analyticsModule);
