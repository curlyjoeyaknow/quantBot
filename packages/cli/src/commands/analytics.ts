/**
 * Analytics Commands
 */

import type { Command } from 'commander';
import { z } from 'zod';
import type { PackageCommandModule } from '../types/index.js';
import { commandRegistry } from '../core/command-registry.js';
import type { CommandContext } from '../core/command-context.js';
import { analyzeAnalyticsHandler } from '../handlers/analytics/analyze-analytics.js';
import { analyzeSchema, metricsSchema, reportSchema } from '../command-defs/analytics.js';

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
      const { execute } = await import('../core/execute.js');
      const commandDef = commandRegistry.getCommand('analytics', 'analyze');
      if (!commandDef) {
        throw new Error('Command analytics analyze not found in registry');
      }
      await execute(commandDef, options);
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
      const { execute } = await import('../core/execute.js');
      const commandDef = commandRegistry.getCommand('analytics', 'metrics');
      if (!commandDef) {
        throw new Error('Command analytics metrics not found in registry');
      }
      await execute(commandDef, options);
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
      const { execute } = await import('../core/execute.js');
      const commandDef = commandRegistry.getCommand('analytics', 'report');
      if (!commandDef) {
        throw new Error('Command analytics report not found in registry');
      }
      await execute(commandDef, options);
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
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof analyzeSchema>;
        return await analyzeAnalyticsHandler(typedArgs, ctx);
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
