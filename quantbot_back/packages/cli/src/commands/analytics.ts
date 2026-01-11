/**
 * Analytics Commands
 */

import type { Command } from 'commander';
import { z } from 'zod';
import type { PackageCommandModule } from '../types/index.js';
import { commandRegistry } from '../core/command-registry.js';
import { defineCommand } from '../core/defineCommand.js';
import { die } from '../core/cliErrors.js';
import { coerceBoolean } from '../core/coerce.js';
import type { CommandContext } from '../core/command-context.js';
import { analyzeAnalyticsHandler } from './analytics/analyze-analytics.js';
import { metricsAnalyticsHandler } from './analytics/metrics-analytics.js';
import { reportAnalyticsHandler } from './analytics/report-analytics.js';
import { analyzeDuckdbHandler } from './analytics/analyze-duckdb.js';
import {
  analyzeSchema,
  metricsSchema,
  reportSchema,
  analyzeDuckdbSchema,
} from '../command-defs/analytics.js';

/**
 * Register analytics commands
 */
export function registerAnalyticsCommands(program: Command): void {
  const analyticsCmd = program
    .command('analytics')
    .description('Analytics and performance metrics');

  // Analyze command
  const analyzeCmd = analyticsCmd
    .command('analyze')
    .description('Analyze calls with metrics')
    .option('--caller <name>', 'Caller name filter')
    .option('--from <date>', 'Start date (ISO 8601)')
    .option('--to <date>', 'End date (ISO 8601)')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(analyzeCmd, {
    name: 'analyze',
    packageName: 'analytics',
    validate: (opts) => analyzeSchema.parse(opts),
    onError: die,
  });

  // Metrics command
  const metricsCmd = analyticsCmd
    .command('metrics')
    .description('Calculate period metrics')
    .option('--caller <name>', 'Caller name filter')
    .option('--from <date>', 'Start date (ISO 8601)')
    .option('--to <date>', 'End date (ISO 8601)')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(metricsCmd, {
    name: 'metrics',
    packageName: 'analytics',
    validate: (opts) => metricsSchema.parse(opts),
    onError: die,
  });

  // Report command
  const reportCmd = analyticsCmd
    .command('report')
    .description('Generate analytics report')
    .option('--caller <name>', 'Caller name filter')
    .option('--from <date>', 'Start date (ISO 8601)')
    .option('--to <date>', 'End date (ISO 8601)')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(reportCmd, {
    name: 'report',
    packageName: 'analytics',
    validate: (opts) => reportSchema.parse(opts),
    onError: die,
  });

  // DuckDB analysis command
  const analyzeDuckdbCmd = analyticsCmd
    .command('analyze-duckdb')
    .description('Statistical analysis using DuckDB Python engine')
    .requiredOption('--duckdb <path>', 'Path to DuckDB file')
    .option('--caller <name>', 'Analyze specific caller')
    .option('--mint <mint>', 'Analyze specific token')
    .option('--correlation', 'Run correlation analysis')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(analyzeDuckdbCmd, {
    name: 'analyze-duckdb',
    packageName: 'analytics',
    coerce: (raw) => ({
      ...raw,
      correlation:
        raw.correlation !== undefined && coerceBoolean(raw.correlation, 'correlation')
          ? {}
          : undefined,
    }),
    validate: (opts) => analyzeDuckdbSchema.parse(opts),
    onError: die,
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
      handler: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof analyzeSchema>;
        return await analyzeAnalyticsHandler(typedArgs, typedCtx);
      },
      examples: ['quantbot analytics analyze --caller Brook --from 2024-01-01 --to 2024-02-01'],
    },
    {
      name: 'metrics',
      description: 'Calculate period metrics',
      schema: metricsSchema,
      handler: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof metricsSchema>;
        return await metricsAnalyticsHandler(typedArgs, typedCtx);
      },
      examples: ['quantbot analytics metrics --caller Brook'],
    },
    {
      name: 'report',
      description: 'Generate analytics report',
      schema: reportSchema,
      handler: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof reportSchema>;
        return await reportAnalyticsHandler(typedArgs, typedCtx);
      },
      examples: ['quantbot analytics report --caller Brook'],
    },
    {
      name: 'analyze-duckdb',
      description: 'Statistical analysis using DuckDB Python engine',
      schema: analyzeDuckdbSchema,
      handler: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof analyzeDuckdbSchema>;
        return await analyzeDuckdbHandler(typedArgs, typedCtx);
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
