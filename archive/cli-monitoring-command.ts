/**
 * Monitoring Commands
 */

import type { Command } from 'commander';
import { z } from 'zod';
import { parseArguments } from '../core/argument-parser';
import { formatOutput } from '../core/output-formatter';
import { handleError } from '../core/error-handler';
import type { PackageCommandModule } from '../types';
import { commandRegistry } from '../core/command-registry';

/**
 * Start command schema
 */
const startSchema = z.object({
  caller: z.string().optional(),
  config: z.string().optional(),
});

/**
 * Stop command schema
 */
const stopSchema = z.object({
  caller: z.string().optional(),
});

/**
 * Status command schema
 */
const statusSchema = z.object({
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * Logs command schema
 */
const logsSchema = z.object({
  caller: z.string().optional(),
  limit: z.number().int().positive().max(1000).default(100),
  follow: z.boolean().default(false),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * Register monitoring commands
 */
export function registerMonitoringCommands(program: Command): void {
  const monitorCmd = program
    .command('monitoring')
    .description('Real-time monitoring operations');

  // Start command
  monitorCmd
    .command('start')
    .description('Start monitoring service')
    .option('--caller <name>', 'Caller name')
    .option('--config <path>', 'Config file path')
    .action(async (options) => {
      try {
        const args = parseArguments(startSchema, options);
        console.error('Starting monitoring service...');
        // TODO: Implement actual monitoring start
        console.log('Monitoring service started');
      } catch (error) {
        const message = handleError(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });

  // Stop command
  monitorCmd
    .command('stop')
    .description('Stop monitoring service')
    .option('--caller <name>', 'Caller name')
    .action(async (options) => {
      try {
        const args = parseArguments(stopSchema, options);
        console.error('Stopping monitoring service...');
        // TODO: Implement actual monitoring stop
        console.log('Monitoring service stopped');
      } catch (error) {
        const message = handleError(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });

  // Status command
  monitorCmd
    .command('status')
    .description('Check monitoring status')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      try {
        const args = parseArguments(statusSchema, options);
        const status = {
          running: false,
          activeCallers: [],
        };
        const output = formatOutput(status, args.format);
        console.log(output);
      } catch (error) {
        const message = handleError(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });

  // Logs command
  monitorCmd
    .command('logs')
    .description('View monitoring logs')
    .option('--caller <name>', 'Caller name filter')
    .option('--limit <limit>', 'Maximum rows', '100')
    .option('--follow', 'Follow log output')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      try {
        const args = parseArguments(logsSchema, {
          ...options,
          limit: options.limit ? parseInt(options.limit, 10) : 100,
          follow: options.follow === true || options.follow === 'true',
        });
        const logs: unknown[] = [];
        const output = formatOutput(logs, args.format);
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
const monitoringModule: PackageCommandModule = {
  packageName: 'monitoring',
  description: 'Real-time monitoring operations',
  commands: [
    {
      name: 'start',
      description: 'Start monitoring service',
      schema: startSchema,
      handler: async () => ({ message: 'Monitoring started' }),
      examples: ['quantbot monitoring start --caller Brook'],
    },
    {
      name: 'stop',
      description: 'Stop monitoring service',
      schema: stopSchema,
      handler: async () => ({ message: 'Monitoring stopped' }),
      examples: ['quantbot monitoring stop --caller Brook'],
    },
    {
      name: 'status',
      description: 'Check monitoring status',
      schema: statusSchema,
      handler: async () => ({ running: false, activeCallers: [] }),
      examples: ['quantbot monitoring status'],
    },
    {
      name: 'logs',
      description: 'View monitoring logs',
      schema: logsSchema,
      handler: async () => [],
      examples: ['quantbot monitoring logs --caller Brook --limit 50'],
    },
  ],
};

// Register the module
commandRegistry.registerPackage(monitoringModule);

