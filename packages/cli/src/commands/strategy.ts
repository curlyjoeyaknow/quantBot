/**
 * Strategy Commands
 */

import type { Command } from 'commander';
import type { PackageCommandModule } from '../types/index.js';
import { commandRegistry } from '../core/command-registry.js';
import {
  strategyDiffSchema,
  type StrategyDiffArgs,
  strategyCompareSchema,
  type StrategyCompareArgs,
  strategyVersionsSchema,
  type StrategyVersionsArgs,
  strategyCompareWebSchema,
  type StrategyCompareWebArgs,
} from '../command-defs/strategy.js';

/**
 * Register strategy commands
 */
export function registerStrategyCommands(program: Command): void {
  // Check if command already exists to avoid duplicate registration
  if (program.commands.find((cmd) => cmd.name() === 'strategy')) {
    return; // Already registered
  }

  const strategyCmd = program.command('strategy').description('Strategy operations');

  // Diff command
  const _diffCmd = strategyCmd
    .command('diff')
    .description('Compare two strategies and show differences')
    .requiredOption('--strategy1 <path>', 'Path to first strategy file or strategy ID')
    .requiredOption('--strategy2 <path>', 'Path to second strategy file or strategy ID')
    .option('--format <format>', 'Output format (json, table, text)', 'text')
    .option('--output <file>', 'Output file path (optional)')
    .action(async (options) => {
      const { execute } = await import('../core/execute.js');
      const commandDef = commandRegistry.getCommand('strategy', 'diff');
      if (!commandDef) {
        throw new Error('Command not found in registry');
      }
      await execute(commandDef, options);
    });

  // Compare command
  const _compareCmd = strategyCmd
    .command('compare')
    .description('Compare strategies and show summary')
    .requiredOption('--strategy1 <path>', 'Path to first strategy file or strategy ID')
    .requiredOption('--strategy2 <path>', 'Path to second strategy file or strategy ID')
    .option('--format <format>', 'Output format (json, table, text)', 'text')
    .action(async (options) => {
      const { execute } = await import('../core/execute.js');
      const commandDef = commandRegistry.getCommand('strategy', 'compare');
      if (!commandDef) {
        throw new Error('Command not found in registry');
      }
      await execute(commandDef, options);
    });

  // Versions command
  const _versionsCmd = strategyCmd
    .command('versions')
    .description('List all versions of a strategy')
    .requiredOption('--strategy-id <id>', 'Strategy ID')
    .option('--format <format>', 'Output format (json, table, text)', 'table')
    .action(async (options) => {
      const { execute } = await import('../core/execute.js');
      const commandDef = commandRegistry.getCommand('strategy', 'versions');
      if (!commandDef) {
        throw new Error('Command not found in registry');
      }
      await execute(commandDef, options);
    });

  // Compare Web UI command
  const _compareWebCmd = strategyCmd
    .command('compare-web')
    .description('Launch strategy comparison web UI with TradingView charting')
    .option('--port <port>', 'Port number', '3002')
    .option('--host <host>', 'Host address', 'localhost')
    .action(async (options) => {
      const { execute } = await import('../core/execute.js');
      const commandDef = commandRegistry.getCommand('strategy', 'compare-web');
      if (!commandDef) {
        throw new Error('Command not found in registry');
      }
      await execute(commandDef, {
        port: parseInt(options.port || '3002', 10),
        host: options.host || 'localhost',
      });
    });
}

// Register command module (side effect)
const strategyModule: PackageCommandModule = {
  packageName: 'strategy',
  description: 'Strategy operations',
  commands: [
    {
      name: 'diff',
      description: 'Compare two strategies and show differences',
      schema: strategyDiffSchema,
      handler: async (args: unknown, _ctx: unknown) => {
        const { diffStrategyHandler } = await import('../handlers/strategy/diff-strategy.js');
        return await diffStrategyHandler(
          args as StrategyDiffArgs,
          _ctx as InstanceType<
            Awaited<typeof import('../core/command-context.js')>['CommandContext']
          >
        );
      },
      examples: [
        'quantbot strategy diff --strategy1 strategy1.json --strategy2 strategy2.json',
        'quantbot strategy diff --strategy1 strategy1.json --strategy2 strategy2.json --format json',
      ],
    },
    {
      name: 'compare',
      description: 'Compare strategies and show summary',
      schema: strategyCompareSchema,
      handler: async (args: unknown, _ctx: unknown) => {
        const { compareStrategyHandler } = await import('../handlers/strategy/compare-strategy.js');
        return await compareStrategyHandler(
          args as StrategyCompareArgs,
          _ctx as InstanceType<
            Awaited<typeof import('../core/command-context.js')>['CommandContext']
          >
        );
      },
      examples: [
        'quantbot strategy compare --strategy1 strategy1.json --strategy2 strategy2.json',
        'quantbot strategy compare --strategy1 strategy1.json --strategy2 strategy2.json --format table',
      ],
    },
    {
      name: 'versions',
      description: 'List all versions of a strategy',
      schema: strategyVersionsSchema,
      handler: async (args: unknown, _ctx: unknown) => {
        const { listStrategyVersionsHandler } =
          await import('../handlers/strategy/list-versions.js');
        return await listStrategyVersionsHandler(
          args as StrategyVersionsArgs,
          _ctx as InstanceType<
            Awaited<typeof import('../core/command-context.js')>['CommandContext']
          >
        );
      },
      examples: ['quantbot strategy versions --strategy-id my-strategy'],
    },
    {
      name: 'compare-web',
      description: 'Launch strategy comparison web UI with TradingView charting',
      schema: strategyCompareWebSchema,
      handler: async (args: unknown, _ctx: unknown) => {
        const { compareWebHandler } = await import('../handlers/strategy/compare-web.js');
        return await compareWebHandler(
          args as StrategyCompareWebArgs,
          _ctx as InstanceType<
            Awaited<typeof import('../core/command-context.js')>['CommandContext']
          >
        );
      },
      examples: [
        'quantbot strategy compare-web',
        'quantbot strategy compare-web --port 3002 --host localhost',
      ],
    },
  ],
};

commandRegistry.registerPackage(strategyModule);
