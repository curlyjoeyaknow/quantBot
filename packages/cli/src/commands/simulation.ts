/**
 * Simulation Commands
 */

import type { Command } from 'commander';
import { z } from 'zod';
import type { PackageCommandModule } from '../types/index.js';
import { commandRegistry } from '../core/command-registry.js';
import { execute } from '../core/execute.js';
import type { CommandContext } from '../core/command-context.js';
import { runSimulationHandler } from '../handlers/simulation/run-simulation.js';
import { listRunsHandler } from '../handlers/simulation/list-runs.js';
import { runSimulationDuckdbHandler } from '../handlers/simulation/run-simulation-duckdb.js';
import { storeStrategyDuckdbHandler } from '../handlers/simulation/store-strategy-duckdb.js';
import { storeRunDuckdbHandler } from '../handlers/simulation/store-run-duckdb.js';
import { generateReportDuckdbHandler } from '../handlers/simulation/generate-report-duckdb.js';
import { clickHouseQueryHandler } from '../handlers/simulation/clickhouse-query.js';
import {
  runSchema,
  listRunsSchema,
  runSimulationDuckdbSchema,
  storeStrategySchema,
  storeRunSchema,
  generateReportSchema,
  clickHouseQuerySchema,
} from '../command-defs/simulation.js';

/**
 * Register simulation commands
 */
export function registerSimulationCommands(program: Command): void {
  const simCmd = program
    .command('simulation')
    .description('Trading strategy simulation operations');

  // Run command
  simCmd
    .command('run')
    .description('Run simulation on calls')
    .requiredOption('--strategy <name>', 'Strategy name')
    .option('--caller <name>', 'Caller name filter')
    .requiredOption('--from <date>', 'Start date (ISO 8601)')
    .requiredOption('--to <date>', 'End date (ISO 8601)')
    .option('--interval <interval>', 'Candle interval (1m, 5m, 15m, 1h)', '1m')
    .option('--pre-window <minutes>', 'Pre-window minutes', '0')
    .option('--post-window <minutes>', 'Post-window minutes', '0')
    .option('--dry-run', 'Do not persist results', false)
    .option('--concurrency <n>', 'Parallelism limit', '8')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      const commandDef = commandRegistry.getCommand('simulation', 'run');
      if (!commandDef) {
        throw new Error('Command simulation run not found in registry');
      }
      await execute(commandDef, {
        ...options,
        preWindow: options.preWindow ? parseInt(options.preWindow, 10) : 0,
        postWindow: options.postWindow ? parseInt(options.postWindow, 10) : 0,
        concurrency: options.concurrency ? parseInt(options.concurrency, 10) : 8,
        dryRun: options.dryRun === true || options.dryRun === 'true',
      });
    });

  // List runs command
  simCmd
    .command('list-runs')
    .description('List simulation runs')
    .option('--caller <name>', 'Caller name filter')
    .option('--from <date>', 'Start date (ISO 8601)')
    .option('--to <date>', 'End date (ISO 8601)')
    .option('--limit <limit>', 'Maximum rows', '100')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      const commandDef = commandRegistry.getCommand('simulation', 'list-runs');
      if (!commandDef) {
        throw new Error('Command simulation list-runs not found in registry');
      }
      await execute(commandDef, {
        ...options,
        limit: options.limit ? parseInt(options.limit, 10) : 100,
      });
    });

  // Store strategy command
  simCmd
    .command('store-strategy')
    .description('Store a strategy in DuckDB')
    .requiredOption('--duckdb <path>', 'Path to DuckDB file')
    .requiredOption('--strategy-id <id>', 'Strategy ID')
    .requiredOption('--name <name>', 'Strategy name')
    .requiredOption('--entry-config <json>', 'Entry config (JSON string)')
    .requiredOption('--exit-config <json>', 'Exit config (JSON string)')
    .option('--reentry-config <json>', 'Reentry config (JSON string)')
    .option('--cost-config <json>', 'Cost config (JSON string)')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      const commandDef = commandRegistry.getCommand('simulation', 'store-strategy');
      if (!commandDef) throw new Error('Command simulation store-strategy not found in registry');
      await execute(commandDef, {
        ...options,
        entryConfig: JSON.parse(options.entryConfig),
        exitConfig: JSON.parse(options.exitConfig),
        reentryConfig: options.reentryConfig ? JSON.parse(options.reentryConfig) : undefined,
        costConfig: options.costConfig ? JSON.parse(options.costConfig) : undefined,
      });
    });

  // Store run command
  simCmd
    .command('store-run')
    .description('Store a simulation run in DuckDB')
    .requiredOption('--duckdb <path>', 'Path to DuckDB file')
    .requiredOption('--run-id <id>', 'Run ID')
    .requiredOption('--strategy-id <id>', 'Strategy ID')
    .requiredOption('--mint <address>', 'Token mint address')
    .requiredOption('--alert-timestamp <timestamp>', 'Alert timestamp (ISO 8601)')
    .requiredOption('--start-time <time>', 'Start time (ISO 8601)')
    .requiredOption('--end-time <time>', 'End time (ISO 8601)')
    .option('--initial-capital <amount>', 'Initial capital', '1000.0')
    .option('--final-capital <amount>', 'Final capital')
    .option('--total-return-pct <pct>', 'Total return percentage')
    .option('--max-drawdown-pct <pct>', 'Max drawdown percentage')
    .option('--sharpe-ratio <ratio>', 'Sharpe ratio')
    .option('--win-rate <rate>', 'Win rate')
    .option('--total-trades <count>', 'Total trades', '0')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      const commandDef = commandRegistry.getCommand('simulation', 'store-run');
      if (!commandDef) throw new Error('Command simulation store-run not found in registry');
      await execute(commandDef, {
        ...options,
        initialCapital: options.initialCapital ? parseFloat(options.initialCapital) : 1000.0,
        finalCapital: options.finalCapital ? parseFloat(options.finalCapital) : undefined,
        totalReturnPct: options.totalReturnPct ? parseFloat(options.totalReturnPct) : undefined,
        maxDrawdownPct: options.maxDrawdownPct ? parseFloat(options.maxDrawdownPct) : undefined,
        sharpeRatio: options.sharpeRatio ? parseFloat(options.sharpeRatio) : undefined,
        winRate: options.winRate ? parseFloat(options.winRate) : undefined,
        totalTrades: options.totalTrades ? parseInt(options.totalTrades, 10) : 0,
      });
    });

  // Generate report command
  simCmd
    .command('generate-report')
    .description('Generate a report from DuckDB simulation data')
    .requiredOption('--duckdb <path>', 'Path to DuckDB file')
    .requiredOption('--type <type>', 'Report type (summary, strategy_performance)')
    .option('--strategy-id <id>', 'Strategy ID (required for strategy_performance)')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      const commandDef = commandRegistry.getCommand('simulation', 'generate-report');
      if (!commandDef) throw new Error('Command simulation generate-report not found in registry');
      await execute(commandDef, options);
    });

  // ClickHouse query command
  simCmd
    .command('clickhouse-query')
    .description('Query ClickHouse using Python engine')
    .requiredOption('--operation <op>', 'Operation (query_ohlcv, store_events, aggregate_metrics)')
    .option('--token-address <address>', 'Token address (for query_ohlcv)')
    .option('--chain <chain>', 'Chain (for query_ohlcv)', 'solana')
    .option('--start-time <time>', 'Start time (ISO 8601, for query_ohlcv)')
    .option('--end-time <time>', 'End time (ISO 8601, for query_ohlcv)')
    .option('--interval <interval>', 'Interval (for query_ohlcv)', '5m')
    .option('--run-id <id>', 'Run ID (for store_events, aggregate_metrics)')
    .option('--events <json>', 'Events array (JSON string, for store_events)')
    .option('--host <host>', 'ClickHouse host', 'localhost')
    .option('--port <port>', 'ClickHouse port', '8123')
    .option('--database <db>', 'ClickHouse database', 'quantbot')
    .option('--username <user>', 'ClickHouse username')
    .option('--password <pass>', 'ClickHouse password')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      const commandDef = commandRegistry.getCommand('simulation', 'clickhouse-query');
      if (!commandDef) throw new Error('Command simulation clickhouse-query not found in registry');
      await execute(commandDef, {
        ...options,
        port: options.port ? parseInt(options.port, 10) : 8123,
        events: options.events ? JSON.parse(options.events) : undefined,
      });
    });
}

/**
 * Register as package command module
 */
const simulationModule: PackageCommandModule = {
  packageName: 'simulation',
  description: 'Trading strategy simulation operations',
  commands: [
    {
      name: 'run',
      description: 'Run simulation on calls',
      schema: runSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof runSchema>;
        return await runSimulationHandler(typedArgs, ctx);
      },
      examples: [
        'quantbot simulation run --strategy PT2_SL25 --caller Brook --from 2024-01-01 --to 2024-02-01',
      ],
    },
    {
      name: 'list-runs',
      description: 'List simulation runs',
      schema: listRunsSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof listRunsSchema>;
        return await listRunsHandler(typedArgs, ctx);
      },
      examples: ['quantbot simulation list-runs --limit 50'],
    },
    {
      name: 'run-duckdb',
      description: 'Run simulation using DuckDB Python engine',
      schema: runSimulationDuckdbSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof runSimulationDuckdbSchema>;
        return await runSimulationDuckdbHandler(typedArgs, ctx);
      },
      examples: [
        'quantbot simulation run-duckdb --duckdb tele.duckdb --strategy strategy.json --mint So111...',
      ],
    },
    {
      name: 'store-strategy',
      description: 'Store a strategy in DuckDB',
      schema: storeStrategySchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof storeStrategySchema>;
        return await storeStrategyDuckdbHandler(typedArgs, ctx);
      },
      examples: [
        'quantbot simulation store-strategy --duckdb sim.duckdb --strategy-id PT2_SL25 --name "PT2 SL25" --entry-config \'{"type":"immediate"}\' --exit-config \'{"targets":[{"target":2.0,"percent":0.5}]}\'',
      ],
    },
    {
      name: 'store-run',
      description: 'Store a simulation run in DuckDB',
      schema: storeRunSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof storeRunSchema>;
        return await storeRunDuckdbHandler(typedArgs, ctx);
      },
      examples: [
        'quantbot simulation store-run --duckdb sim.duckdb --run-id run123 --strategy-id PT2_SL25 --mint So111... --alert-timestamp 2024-01-01T00:00:00Z --start-time 2024-01-01T00:00:00Z --end-time 2024-01-02T00:00:00Z',
      ],
    },
    {
      name: 'generate-report',
      description: 'Generate a report from DuckDB simulation data',
      schema: generateReportSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof generateReportSchema>;
        return await generateReportDuckdbHandler(typedArgs, ctx);
      },
      examples: [
        'quantbot simulation generate-report --duckdb sim.duckdb --type summary',
        'quantbot simulation generate-report --duckdb sim.duckdb --type strategy_performance --strategy-id PT2_SL25',
      ],
    },
    {
      name: 'clickhouse-query',
      description: 'Query ClickHouse using Python engine',
      schema: clickHouseQuerySchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof clickHouseQuerySchema>;
        return await clickHouseQueryHandler(typedArgs, ctx);
      },
      examples: [
        'quantbot simulation clickhouse-query --operation query_ohlcv --token-address So111... --chain solana --start-time 2024-01-01T00:00:00Z --end-time 2024-01-02T00:00:00Z',
        'quantbot simulation clickhouse-query --operation aggregate_metrics --run-id run123',
      ],
    },
  ],
};

// Register the module
commandRegistry.registerPackage(simulationModule);
