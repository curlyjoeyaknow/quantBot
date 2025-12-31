/**
 * Backtest Commands
 * 
 * Note: These commands perform deterministic backtests over historical data.
 * For future stochastic simulations, see the simulation module.
 */

import type { Command } from 'commander';
import { z } from 'zod';
import type { PackageCommandModule } from '../types/index.js';
import { defineCommand } from '../core/defineCommand.js';
import { die } from '../core/cliErrors.js';
import { coerceNumber, coerceBoolean, coerceJson } from '../core/coerce.js';
import { commandRegistry } from '../core/command-registry.js';
import type { CommandContext } from '../core/command-context.js';
import { runSimulationHandler } from './simulation/run-simulation.js';
import { listRunsHandler } from './simulation/list-runs.js';
import { runsHandler } from './simulation/runs.js';
import { leaderboardHandler } from './simulation/leaderboard.js';
import { runSimulationDuckdbHandler } from './simulation/run-simulation-duckdb.js';
import { storeStrategyDuckdbHandler } from './simulation/store-strategy-duckdb.js';
import { storeRunDuckdbHandler } from './simulation/store-run-duckdb.js';
import { generateReportDuckdbHandler } from './simulation/generate-report-duckdb.js';
import { clickHouseQueryHandler } from './simulation/clickhouse-query.js';
import { listStrategiesHandler } from './simulation/list-strategies.js';
import { runInteractiveStrategyCreation } from './simulation-strategy-interactive.js';
import {
  runSchema,
  listRunsSchema,
  leaderboardSchema,
  runSimulationDuckdbSchema,
  storeStrategySchema,
  storeRunSchema,
  generateReportSchema,
  clickHouseQuerySchema,
  listStrategiesSchema,
  createStrategyInteractiveSchema,
} from '../command-defs/simulation.js';

/**
 * Register backtest commands
 * 
 * Also registers deprecated 'simulation' alias with warning.
 */
export function registerSimulationCommands(program: Command): void {
  // Main backtest command
  const backtestCmd = program
    .command('backtest')
    .description('Trading strategy backtest operations (deterministic replay over historical data)');

  // Deprecated simulation alias
  const simCmd = program
    .command('simulation')
    .description('⚠️  DEPRECATED: Use "backtest" instead. This alias will be removed in a future version.')
    .action(() => {
      console.warn('⚠️  Warning: "simulation" command is deprecated. Use "backtest" instead.');
    });

  // Use backtestCmd for all subcommands
  const cmd = backtestCmd;

  // Run command
  const runCmd = cmd
    .command('run')
    .description('Run backtest on calls (deterministic replay over historical data)')
    .requiredOption('--strategy <name>', 'Strategy name')
    .option('--caller <name>', 'Caller name filter')
    .requiredOption('--from <date>', 'Start date (ISO 8601)')
    .requiredOption('--to <date>', 'End date (ISO 8601)')
    .option('--interval <interval>', 'Candle interval (1m, 5m, 15m, 1h)', '1m')
    .option('--pre-window <minutes>', 'Pre-window minutes')
    .option('--post-window <minutes>', 'Post-window minutes')
    .option('--dry-run', 'Do not persist results')
    .option('--concurrency <n>', 'Parallelism limit')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(runCmd, {
    name: 'run',
    packageName: 'simulation',
    coerce: (raw) => ({
      ...raw,
      preWindow: raw.preWindow ? coerceNumber(raw.preWindow, 'pre-window') : 0,
      postWindow: raw.postWindow ? coerceNumber(raw.postWindow, 'post-window') : 0,
      concurrency: raw.concurrency ? coerceNumber(raw.concurrency, 'concurrency') : 8,
      dryRun: raw.dryRun !== undefined ? coerceBoolean(raw.dryRun, 'dry-run') : false,
    }),
    validate: (opts) => runSchema.parse(opts),
    onError: die,
  });

  // List runs command
  const listRunsCmd = cmd
    .command('list-runs')
    .description('List backtest runs')
    .option('--caller <name>', 'Caller name filter')
    .option('--from <date>', 'Start date (ISO 8601)')
    .option('--to <date>', 'End date (ISO 8601)')
    .option('--limit <limit>', 'Maximum rows')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(listRunsCmd, {
    name: 'list-runs',
    packageName: 'simulation',
    coerce: (raw) => ({
      ...raw,
      limit: raw.limit ? coerceNumber(raw.limit, 'limit') : 100,
    }),
    validate: (opts) => listRunsSchema.parse(opts),
    onError: die,
  });

  // Runs command (simple, last 20)
  const runsCmd = cmd.command('runs').description('List last 20 backtest runs');

  defineCommand(runsCmd, {
    name: 'runs',
    packageName: 'simulation',
    coerce: () => ({}),
    validate: () => ({}),
    onError: die,
  });

  // Leaderboard command
  const leaderboardCmd = cmd
    .command('leaderboard')
    .description('Show backtest leaderboard (ranked by ROI)')
    .option('--strategy-id <id>', 'Strategy ID filter')
    .option('--interval-sec <seconds>', 'Interval in seconds filter')
    .option('--from <date>', 'Start date (ISO 8601)')
    .option('--to <date>', 'End date (ISO 8601)')
    .option('--min-trades <count>', 'Minimum trades filter')
    .option('--limit <limit>', 'Maximum rows', '50')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(leaderboardCmd, {
    name: 'leaderboard',
    packageName: 'simulation',
    coerce: (raw) => ({
      ...raw,
      limit: raw.limit ? coerceNumber(raw.limit, 'limit') : 50,
      interval_sec: raw.intervalSec ? coerceNumber(raw.intervalSec, 'interval-sec') : undefined,
      min_trades: raw.minTrades ? coerceNumber(raw.minTrades, 'min-trades') : undefined,
    }),
    validate: (opts) => leaderboardSchema.parse(opts),
    onError: die,
  });

  // List strategies command
  const listStrategiesCmd = cmd
    .command('list-strategies')
    .description('List all available strategies')
    .option('--duckdb <path>', 'Path to DuckDB file')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(listStrategiesCmd, {
    name: 'list-strategies',
    packageName: 'simulation',
    validate: (opts) => listStrategiesSchema.parse(opts),
    onError: die,
  });

  // Create strategy (interactive) command
  // Note: This is an interactive command that doesn't use execute() or the standard handler pattern.
  // It's kept as-is per the migration plan's guidance for special cases.
  cmd
    .command('create-strategy')
    .alias('strategy-create')
    .description('🎯 Interactive strategy creation (guided prompts)')
    .option('--duckdb <path>', 'Path to DuckDB file', process.env.DUCKDB_PATH || 'data/tele.duckdb')
    .action(async (options) => {
      await runInteractiveStrategyCreation(options.duckdb);
    });

  // Store strategy command
  const storeStrategyCmd = cmd
    .command('store-strategy')
    .description('Store a strategy in DuckDB')
    .requiredOption('--duckdb <path>', 'Path to DuckDB file')
    .requiredOption('--strategy-id <id>', 'Strategy ID')
    .requiredOption('--name <name>', 'Strategy name')
    .requiredOption('--entry-config <json>', 'Entry config (JSON string)')
    .requiredOption('--exit-config <json>', 'Exit config (JSON string)')
    .option('--reentry-config <json>', 'Reentry config (JSON string)')
    .option('--cost-config <json>', 'Cost config (JSON string)')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(storeStrategyCmd, {
    name: 'store-strategy',
    packageName: 'simulation',
    coerce: (raw) => ({
      ...raw,
      entryConfig: raw.entryConfig
        ? coerceJson<Record<string, unknown>>(raw.entryConfig, 'entry-config')
        : undefined,
      exitConfig: raw.exitConfig
        ? coerceJson<Record<string, unknown>>(raw.exitConfig, 'exit-config')
        : undefined,
      reentryConfig: raw.reentryConfig
        ? coerceJson<Record<string, unknown>>(raw.reentryConfig, 'reentry-config')
        : undefined,
      costConfig: raw.costConfig
        ? coerceJson<Record<string, unknown>>(raw.costConfig, 'cost-config')
        : undefined,
    }),
    validate: (opts) => storeStrategySchema.parse(opts),
    onError: die,
  });

  // Store run command
  const storeRunCmd = cmd
    .command('store-run')
    .description('Store a backtest run in DuckDB')
    .requiredOption('--duckdb <path>', 'Path to DuckDB file')
    .requiredOption('--run-id <id>', 'Run ID')
    .requiredOption('--strategy-id <id>', 'Strategy ID')
    .requiredOption('--mint <address>', 'Token mint address')
    .requiredOption('--alert-timestamp <timestamp>', 'Alert timestamp (ISO 8601)')
    .requiredOption('--start-time <time>', 'Start time (ISO 8601)')
    .requiredOption('--end-time <time>', 'End time (ISO 8601)')
    .option('--initial-capital <amount>', 'Initial capital')
    .option('--final-capital <amount>', 'Final capital')
    .option('--total-return-pct <pct>', 'Total return percentage')
    .option('--max-drawdown-pct <pct>', 'Max drawdown percentage')
    .option('--sharpe-ratio <ratio>', 'Sharpe ratio')
    .option('--win-rate <rate>', 'Win rate')
    .option('--total-trades <count>', 'Total trades')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(storeRunCmd, {
    name: 'store-run',
    packageName: 'simulation',
    coerce: (raw) => ({
      ...raw,
      initialCapital: raw.initialCapital
        ? coerceNumber(raw.initialCapital, 'initial-capital')
        : 1000.0,
      finalCapital: raw.finalCapital ? coerceNumber(raw.finalCapital, 'final-capital') : undefined,
      totalReturnPct: raw.totalReturnPct
        ? coerceNumber(raw.totalReturnPct, 'total-return-pct')
        : undefined,
      maxDrawdownPct: raw.maxDrawdownPct
        ? coerceNumber(raw.maxDrawdownPct, 'max-drawdown-pct')
        : undefined,
      sharpeRatio: raw.sharpeRatio ? coerceNumber(raw.sharpeRatio, 'sharpe-ratio') : undefined,
      winRate: raw.winRate ? coerceNumber(raw.winRate, 'win-rate') : undefined,
      totalTrades: raw.totalTrades ? coerceNumber(raw.totalTrades, 'total-trades') : 0,
    }),
    validate: (opts) => storeRunSchema.parse(opts),
    onError: die,
  });

  // Run DuckDB command
  const runDuckdbCmd = cmd
    .command('run-duckdb')
    .description('Run backtest using DuckDB Python engine (deterministic replay)')
    .requiredOption('--duckdb <path>', 'Path to DuckDB file')
    .requiredOption('--strategy <json>', 'Strategy config (JSON string)')
    .option('--mint <address>', 'Token mint address (for single backtest)')
    .option('--alert-timestamp <timestamp>', 'Alert timestamp (ISO 8601, for single backtest)')
    .option('--batch', 'Run batch backtest on all calls in DuckDB')
    .option('--initial-capital <amount>', 'Initial capital')
    .option('--lookback-minutes <minutes>', 'Lookback minutes')
    .option('--lookforward-minutes <minutes>', 'Lookforward minutes')
    .option('--resume', 'Skip tokens with insufficient data and continue')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(runDuckdbCmd, {
    name: 'run-duckdb',
    packageName: 'simulation',
    coerce: (raw) => ({
      ...raw,
      strategy: raw.strategy
        ? coerceJson<Record<string, unknown>>(raw.strategy, 'strategy')
        : undefined,
      alertTimestamp: raw.alertTimestamp,
      initialCapital: raw.initialCapital
        ? coerceNumber(raw.initialCapital, 'initial-capital')
        : 1000.0,
      lookbackMinutes: raw.lookbackMinutes
        ? coerceNumber(raw.lookbackMinutes, 'lookback-minutes')
        : 260,
      lookforwardMinutes: raw.lookforwardMinutes
        ? coerceNumber(raw.lookforwardMinutes, 'lookforward-minutes')
        : 1440,
      batch: raw.batch !== undefined ? coerceBoolean(raw.batch, 'batch') : false,
      resume: raw.resume !== undefined ? coerceBoolean(raw.resume, 'resume') : false,
    }),
    validate: (opts) => runSimulationDuckdbSchema.parse(opts),
    onError: die,
  });

  // Generate report command
  const generateReportCmd = cmd
    .command('generate-report')
    .description('Generate a report from DuckDB backtest data')
    .requiredOption('--duckdb <path>', 'Path to DuckDB file')
    .requiredOption('--type <type>', 'Report type (summary, strategy_performance)')
    .option('--strategy-id <id>', 'Strategy ID (required for strategy_performance)')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(generateReportCmd, {
    name: 'generate-report',
    packageName: 'simulation',
    validate: (opts) => generateReportSchema.parse(opts),
    onError: die,
  });

  // ClickHouse query command
  const clickhouseQueryCmd = cmd
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
    .option('--port <port>', 'ClickHouse port')
    .option('--database <db>', 'ClickHouse database', 'quantbot')
    .option('--username <user>', 'ClickHouse username')
    .option('--password <pass>', 'ClickHouse password')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(clickhouseQueryCmd, {
    name: 'clickhouse-query',
    packageName: 'simulation',
    coerce: (raw) => ({
      ...raw,
      port: raw.port ? coerceNumber(raw.port, 'port') : 8123,
      events: raw.events ? coerceJson<unknown[]>(raw.events, 'events') : undefined,
    }),
    validate: (opts) => clickHouseQuerySchema.parse(opts),
    onError: die,
  });
}

/**
 * Register as package command module
 */
const simulationModule: PackageCommandModule = {
  packageName: 'simulation', // Keep internal package name as 'simulation' for now
  description: 'Trading strategy backtest operations (deterministic replay over historical data)',
  commands: [
    {
      name: 'run',
      description: 'Run backtest on calls (deterministic replay over historical data)',
      schema: runSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedArgs = args as z.infer<typeof runSchema>;
        const typedCtx = ctx as CommandContext;
        return await runSimulationHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot backtest run --strategy PT2_SL25 --caller Brook --from 2024-01-01 --to 2024-02-01',
      ],
    },
    {
      name: 'list-runs',
      description: 'List backtest runs',
      schema: listRunsSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof listRunsSchema>;
        return await listRunsHandler(typedArgs, typedCtx);
      },
      examples: ['quantbot backtest list-runs --limit 50'],
    },
    {
      name: 'runs',
      description: 'List last 20 backtest runs',
      schema: z.object({}),
      handler: async (_args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        return await runsHandler(typedCtx);
      },
      examples: ['quantbot backtest runs'],
    },
    {
      name: 'leaderboard',
      description: 'Show backtest leaderboard (ranked by ROI)',
      schema: leaderboardSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof leaderboardSchema>;
        return await leaderboardHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot backtest leaderboard',
        'quantbot backtest leaderboard --strategy-id PT2_SL25 --limit 20',
      ],
    },
    {
      name: 'run-duckdb',
      description: 'Run backtest using DuckDB Python engine (deterministic replay)',
      schema: runSimulationDuckdbSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof runSimulationDuckdbSchema>;
        return await runSimulationDuckdbHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot backtest run-duckdb --duckdb tele.duckdb --strategy strategy.json --mint So111...',
      ],
    },
    {
      name: 'store-strategy',
      description: 'Store a strategy in DuckDB',
      schema: storeStrategySchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof storeStrategySchema>;
        return await storeStrategyDuckdbHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot backtest store-strategy --duckdb sim.duckdb --strategy-id PT2_SL25 --name "PT2 SL25" --entry-config \'{"type":"immediate"}\' --exit-config \'{"targets":[{"target":2.0,"percent":0.5}]}\'',
      ],
    },
    {
      name: 'store-run',
      description: 'Store a backtest run in DuckDB',
      schema: storeRunSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof storeRunSchema>;
        return await storeRunDuckdbHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot backtest store-run --duckdb sim.duckdb --run-id run123 --strategy-id PT2_SL25 --mint So111... --alert-timestamp 2024-01-01T00:00:00Z --start-time 2024-01-01T00:00:00Z --end-time 2024-01-02T00:00:00Z',
      ],
    },
    {
      name: 'generate-report',
      description: 'Generate a report from DuckDB backtest data',
      schema: generateReportSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof generateReportSchema>;
        return await generateReportDuckdbHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot backtest generate-report --duckdb sim.duckdb --type summary',
        'quantbot backtest generate-report --duckdb sim.duckdb --type strategy_performance --strategy-id PT2_SL25',
      ],
    },
    {
      name: 'clickhouse-query',
      description: 'Query ClickHouse using Python engine',
      schema: clickHouseQuerySchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof clickHouseQuerySchema>;
        return await clickHouseQueryHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot backtest clickhouse-query --operation query_ohlcv --token-address So111... --chain solana --start-time 2024-01-01T00:00:00Z --end-time 2024-01-02T00:00:00Z',
        'quantbot backtest clickhouse-query --operation aggregate_metrics --run-id run123',
      ],
    },
    {
      name: 'list-strategies',
      description: 'List all available strategies',
      schema: listStrategiesSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof listStrategiesSchema>;
        return await listStrategiesHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot backtest list-strategies',
        'quantbot backtest list-strategies --duckdb data/tele.duckdb --format json',
      ],
    },
    {
      name: 'create-strategy',
      description: '🎯 Interactive strategy creation (guided prompts)',
      schema: createStrategyInteractiveSchema,
      handler: async (args: unknown, _ctx: unknown) => {
        const typedArgs = args as z.infer<typeof createStrategyInteractiveSchema>;
        await runInteractiveStrategyCreation(typedArgs.duckdb);
        return { success: true };
      },
      examples: [
        'quantbot backtest create-strategy',
        'quantbot backtest create-strategy --duckdb data/tele.duckdb',
      ],
    },
  ],
};

// Register the module
commandRegistry.registerPackage(simulationModule);
