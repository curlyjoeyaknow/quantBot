/**
 * Analytics Commands
 */

import type { Command } from 'commander';
import { z } from 'zod';
import type { PackageCommandModule } from '../types/index.js';
import { commandRegistry } from '../core/command-registry.js';
import type { CommandContext } from '../core/command-context.js';
import { analyzeAnalyticsHandler } from '../handlers/analytics/analyze-analytics.js';
import { metricsAnalyticsHandler } from '../handlers/analytics/metrics-analytics.js';
import { reportAnalyticsHandler } from '../handlers/analytics/report-analytics.js';
import { analyzeDuckdbHandler } from '../handlers/analytics/analyze-duckdb.js';
import { analyzeSchema, metricsSchema, reportSchema, analyzeDuckdbSchema } from '../command-defs/analytics.js';

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

  // DuckDB analysis command
  analyticsCmd
    .command('analyze-duckdb')
    .description('Statistical analysis using DuckDB Python engine')
    .requiredOption('--duckdb <path>', 'Path to DuckDB file')
    .option('--caller <name>', 'Analyze specific caller')
    .option('--mint <mint>', 'Analyze specific token')
    .option('--correlation', 'Run correlation analysis', false)
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      const { execute } = await import('../core/execute.js');
      const commandDef = commandRegistry.getCommand('analytics', 'analyze-duckdb');
      if (!commandDef) {
        throw new Error('Command analytics analyze-duckdb not found in registry');
      }
      await execute(commandDef, {
        duckdb: options.duckdb,
        caller: options.caller,
        mint: options.mint,
        correlation: options.correlation === true || options.correlation === 'true' ? {} : undefined,
        format: options.format,
      });
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
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof metricsSchema>;
        return await metricsAnalyticsHandler(typedArgs, ctx);
      },
      examples: ['quantbot analytics metrics --caller Brook'],
    },
    {
      name: 'report',
      description: 'Generate analytics report',
      schema: reportSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof reportSchema>;
        return await reportAnalyticsHandler(typedArgs, ctx);
      },
      examples: ['quantbot analytics report --caller Brook'],
    },
    {
      name: 'analyze-duckdb',
      description: 'Statistical analysis using DuckDB Python engine',
      schema: analyzeDuckdbSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof analyzeDuckdbSchema>;
        return await analyzeDuckdbHandler(typedArgs, ctx);
      },
      examples: [
        'quantbot analytics analyze-duckdb --duckdb tele.duckdb --caller Brook',
        'quantbot analytics analyze-duckdb --duckdb tele.duckdb --mint So111...',
      ],
    },
  ],
};

// Register the module
commandRegistry.registerPackage(analyticsModule);
