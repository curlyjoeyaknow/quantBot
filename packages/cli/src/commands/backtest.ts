/**
 * Backtest Commands - Golden path CLI
 */

import type { Command } from 'commander';
import type { PackageCommandModule } from '../types/index.js';
import { defineCommand } from '../core/defineCommand.js';
import { die } from '../core/cliErrors.js';
import {
  coerceNumber,
  coerceBoolean,
  coerceStringArray,
  coerceNumberArray,
} from '../core/coerce.js';
import { commandRegistry } from '../core/command-registry.js';
import { DateTime } from 'luxon';
import { runBacktest } from '@quantbot/backtest';
import {
  backtestRunSchema,
  type BacktestRunArgs,
  backtestCallersSchema,
  type BacktestCallersArgs,
  backtestListSchema,
  type BacktestListArgs,
  backtestLeaderboardSchema,
  type BacktestLeaderboardArgs,
  backtestTruthLeaderboardSchema,
  type BacktestTruthLeaderboardArgs,
  backtestPolicySchema,
  type BacktestPolicyArgs,
  backtestOptimizeSchema,
  type BacktestOptimizeArgs,
  backtestBaselineSchema,
  type BacktestBaselineArgs,
  backtestV1BaselineSchema,
  type BacktestV1BaselineArgs,
  catalogSyncSchema,
  type CatalogSyncArgs,
  catalogQuerySchema,
  type CatalogQueryArgs,
} from '../command-defs/backtest.js';
import { join, resolve as pathResolve } from 'path';
import { existsSync } from 'fs';

/**
 * Create DuckDB connection adapter for backtest reporting functions
 */
function createDuckDbAdapter(db: any) {
  return {
    all<T = any>(sql: string, params: any[], callback: (err: any, rows: T[]) => void): void {
      (db.all as any)(sql, params, (err: any, rows: any) => {
        if (err) {
          callback(err, []);
        } else {
          callback(null, rows as T[]);
        }
      });
    },
  };
}

/**
 * Register backtest commands
 */
export function registerBacktestCommands(program: Command): void {
  // Check if command already exists to avoid duplicate registration
  if (program.commands.find((cmd) => cmd.name() === 'backtest')) {
    return; // Already registered
  }

  const backtestCmd = program.command('backtest').description('Backtest operations (golden path)');

  const runCmd = backtestCmd
    .command('run')
    .description('Run backtest on strategy')
    .option('--run-id <id>', 'Run ID (provided by Lab UI, optional for backward compat)')
    .option('--strategy-id <id>', 'Strategy ID from DuckDB (required for exit-stack mode)')
    .requiredOption(
      '--strategy <mode>',
      'Strategy mode: path-only (truth layer), exit-optimizer, or exit-stack'
    )
    .option('--filter <id>', 'Filter ID')
    .requiredOption('--interval <interval>', 'Candle interval (1m, 5m, etc.)')
    .requiredOption('--from <date>', 'Start date (ISO 8601)')
    .requiredOption('--to <date>', 'End date (ISO 8601)')
    .option('--taker-fee-bps <number>', 'Taker fee in basis points', '30')
    .option('--slippage-bps <number>', 'Slippage in basis points', '10')
    .option(
      '--execution-model <venue>',
      'Execution model: pumpfun, pumpswap, raydium, minimal, simple',
      'simple'
    )
    .option('--position-usd <number>', 'Position size in USD', '1000')
    .option('--include-replay', 'Include replay frames')
    .option('--activity-move-pct <number>', 'Activity move threshold (default: 0.1 = 10%)', '0.1');

  defineCommand(runCmd, {
    name: 'run',
    packageName: 'backtest',
    coerce: (raw) => ({
      ...raw,
      runId: raw.runId || undefined,
      strategyId: raw.strategyId || undefined,
      takerFeeBps: raw.takerFeeBps ? coerceNumber(raw.takerFeeBps, 'taker-fee-bps') : 30,
      slippageBps: raw.slippageBps ? coerceNumber(raw.slippageBps, 'slippage-bps') : 10,
      positionUsd: raw.positionUsd ? coerceNumber(raw.positionUsd, 'position-usd') : 1000,
      includeReplay:
        raw.includeReplay !== undefined
          ? coerceBoolean(raw.includeReplay, 'include-replay')
          : false,
      activityMovePct: raw.activityMovePct
        ? coerceNumber(raw.activityMovePct, 'activity-move-pct')
        : 0.1,
    }),
    validate: (opts) => backtestRunSchema.parse(opts),
    onError: die,
  });

  const callersCmd = backtestCmd
    .command('callers')
    .description('Show caller path metrics report for a backtest run')
    .requiredOption('--run-id <id>', 'Backtest run ID')
    .option(
      '--sort <field>',
      'Sort field (calls, count_2x, count_3x, count_4x, p_hit_2x, p_hit_3x, p_hit_4x, avg_peak_multiple)',
      'count_4x'
    )
    .option('--format <format>', 'Output format (json, table, csv)', 'table');

  defineCommand(callersCmd, {
    name: 'callers',
    packageName: 'backtest',
    validate: (opts) => backtestCallersSchema.parse(opts),
    onError: die,
  });

  const listCmd = backtestCmd
    .command('list')
    .description('List all past backtest runs with aggregates')
    .option('--format <format>', 'Output format (json, table, csv)', 'table');

  defineCommand(listCmd, {
    name: 'list',
    packageName: 'backtest',
    validate: (opts) => backtestListSchema.parse(opts),
    onError: die,
  });

  const leaderboardCmd = backtestCmd
    .command('leaderboard')
    .description('Show caller leaderboard based on PnL% with drawdown sorting')
    .option(
      '--run-id <id>',
      'Optional run ID to filter by (if not provided, aggregates across all runs)'
    )
    .option('--min-calls <number>', 'Minimum number of calls required (default: 20)', '20')
    .option('--format <format>', 'Output format (json, table, csv)', 'table');

  defineCommand(leaderboardCmd, {
    name: 'leaderboard',
    packageName: 'backtest',
    coerce: (raw) => ({
      ...raw,
      minCalls: raw.minCalls ? coerceNumber(raw.minCalls, 'min-calls') : 20,
    }),
    validate: (opts) => backtestLeaderboardSchema.parse(opts),
    onError: die,
  });

  // Truth leaderboard command (Phase 3 - MVP 1: Caller Worth Leaderboard)
  const truthLeaderboardCmd = backtestCmd
    .command('truth-leaderboard')
    .description('Show caller leaderboard from path metrics only (truth layer)')
    .requiredOption('--run-id <id>', 'Backtest run ID')
    .option('--min-calls <number>', 'Minimum number of calls required (default: 0)', '0')
    .option('--format <format>', 'Output format (json, table, csv)', 'table');

  defineCommand(truthLeaderboardCmd, {
    name: 'truth-leaderboard',
    packageName: 'backtest',
    coerce: (raw) => ({
      ...raw,
      minCalls: raw.minCalls ? coerceNumber(raw.minCalls, 'min-calls') : 0,
    }),
    validate: (opts) => backtestTruthLeaderboardSchema.parse(opts),
    onError: die,
  });

  // Policy command (Phase 4 - MVP 2: Risk Policy Primitives)
  const policyCmd = backtestCmd
    .command('policy')
    .description('Execute a risk policy against calls with candle replay')
    .requiredOption('--policy-json <json>', 'Risk policy as JSON string')
    .option('--policy-id <id>', 'Policy ID (auto-generated if not provided)')
    .option('--filter <caller>', 'Filter by caller name')
    .requiredOption('--interval <interval>', 'Candle interval (1m, 5m, etc.)')
    .requiredOption('--from <date>', 'Start date (ISO 8601)')
    .requiredOption('--to <date>', 'End date (ISO 8601)')
    .option('--taker-fee-bps <number>', 'Taker fee in basis points', '30')
    .option('--slippage-bps <number>', 'Slippage in basis points', '10')
    .option(
      '--execution-model <venue>',
      'Execution model: pumpfun, pumpswap, raydium, minimal, simple',
      'simple'
    )
    .option('--run-id <id>', 'Existing run ID to use')
    .option('--format <format>', 'Output format (json, table, csv)', 'json');

  defineCommand(policyCmd, {
    name: 'policy',
    packageName: 'backtest',
    coerce: (raw) => ({
      ...raw,
      policyId: raw.policyId || undefined,
      takerFeeBps: raw.takerFeeBps ? coerceNumber(raw.takerFeeBps, 'taker-fee-bps') : 30,
      slippageBps: raw.slippageBps ? coerceNumber(raw.slippageBps, 'slippage-bps') : 10,
    }),
    validate: (opts) => backtestPolicySchema.parse(opts),
    onError: die,
  });

  // Optimize command (Phase 5 - MVP 3: Policy Optimizer)
  const optimizeCmd = backtestCmd
    .command('optimize')
    .description('Grid search to find optimal policy for callers')
    .option('--caller <name>', 'Caller name to optimize for (if omitted, optimizes for all)')
    .option(
      '--caller-groups <json>',
      'JSON array of caller names to optimize for: ["caller1","caller2"]'
    )
    .requiredOption('--interval <interval>', 'Candle interval (1m, 5m, etc.)')
    .requiredOption('--from <date>', 'Start date (ISO 8601)')
    .requiredOption('--to <date>', 'End date (ISO 8601)')
    .option('--max-stop-out-rate <rate>', 'Max stop-out rate constraint (default: 0.3)', '0.3')
    .option(
      '--max-p95-drawdown-bps <bps>',
      'Max p95 drawdown constraint in bps (default: -3000)',
      '-3000'
    )
    .option(
      '--max-time-exposed-ms <ms>',
      'Max time exposed constraint in ms (default: 48h)',
      String(48 * 60 * 60 * 1000)
    )
    .option('--taker-fee-bps <number>', 'Taker fee in basis points', '30')
    .option('--slippage-bps <number>', 'Slippage in basis points', '10')
    .option(
      '--execution-model <venue>',
      'Execution model: pumpfun, pumpswap, raydium, minimal, simple',
      'simple'
    )
    .option('--format <format>', 'Output format (json, table, csv)', 'table');

  defineCommand(optimizeCmd, {
    name: 'optimize',
    packageName: 'backtest',
    coerce: (raw) => ({
      ...raw,
      caller: raw.caller || undefined,
      callerGroups: raw.callerGroups
        ? coerceStringArray(raw.callerGroups, 'caller-groups')
        : undefined,
      maxStopOutRate: raw.maxStopOutRate
        ? coerceNumber(raw.maxStopOutRate, 'max-stop-out-rate')
        : 0.3,
      maxP95DrawdownBps: raw.maxP95DrawdownBps
        ? coerceNumber(raw.maxP95DrawdownBps, 'max-p95-drawdown-bps')
        : -3000,
      maxTimeExposedMs: raw.maxTimeExposedMs
        ? coerceNumber(raw.maxTimeExposedMs, 'max-time-exposed-ms')
        : 48 * 60 * 60 * 1000,
      takerFeeBps: raw.takerFeeBps ? coerceNumber(raw.takerFeeBps, 'taker-fee-bps') : 30,
      slippageBps: raw.slippageBps ? coerceNumber(raw.slippageBps, 'slippage-bps') : 10,
    }),
    validate: (opts) => backtestOptimizeSchema.parse(opts),
    onError: die,
  });

  // Baseline command - per-alert backtest with ATH, drawdowns, time-to-2x, TP/SL
  const baselineCmd = backtestCmd
    .command('baseline')
    .description('Run baseline per-alert backtest (ATH, drawdowns, time-to-2x, TP/SL)')
    .option('--duckdb <path>', 'Path to DuckDB with alerts', 'data/alerts.duckdb')
    .option('--chain <chain>', 'Chain to filter (default: solana)', 'solana')
    .option('--from <date>', 'Start date YYYY-MM-DD (default: 30 days ago)')
    .option('--to <date>', 'End date YYYY-MM-DD (default: today)')
    .option('--interval-seconds <seconds>', 'Candle interval (60 or 300)', '60')
    .option('--horizon-hours <hours>', 'Horizon in hours', '48')
    .option('--threads <n>', 'Number of threads', '16')
    // Slice management (offline backtest)
    .option('--slice-dir <dir>', 'Directory for Parquet slice files', 'slices')
    .option('--reuse-slice', 'Reuse existing slice if available')
    .option('--min-coverage-pct <pct>', 'Minimum coverage percentage (0.0-1.0)', '0.8')
    // Output
    .option('--out-dir <dir>', 'Output directory for results', 'results')
    .option('--out-csv <path>', 'Explicit output CSV path')
    // ClickHouse (native protocol)
    .option('--ch-host <host>', 'ClickHouse host')
    .option('--ch-port <port>', 'ClickHouse native port')
    .option('--ch-db <db>', 'ClickHouse database')
    .option('--ch-table <table>', 'ClickHouse table')
    .option('--ch-user <user>', 'ClickHouse user')
    .option('--ch-pass <password>', 'ClickHouse password')
    .option('--ch-connect-timeout <seconds>', 'ClickHouse connect timeout')
    .option('--ch-timeout-s <seconds>', 'ClickHouse query timeout')
    // (TP/SL policy removed - pure path metrics only)
    .option('--format <format>', 'Output format (json, table, csv)', 'table')
    .option('--tui', 'Enable live TUI dashboard (runs Python script directly)');

  defineCommand(baselineCmd, {
    name: 'baseline',
    packageName: 'backtest',
    coerce: (raw) => ({
      ...raw,
      intervalSeconds: raw.intervalSeconds
        ? coerceNumber(raw.intervalSeconds, 'interval-seconds')
        : 60,
      horizonHours: raw.horizonHours ? coerceNumber(raw.horizonHours, 'horizon-hours') : 48,
      threads: raw.threads ? coerceNumber(raw.threads, 'threads') : 16,
      // Slice management
      reuseSlice:
        raw.reuseSlice !== undefined ? coerceBoolean(raw.reuseSlice, 'reuse-slice') : false,
      minCoveragePct: raw.minCoveragePct
        ? coerceNumber(raw.minCoveragePct, 'min-coverage-pct')
        : 0.8,
      // ClickHouse (native protocol)
      chPort: raw.chPort ? coerceNumber(raw.chPort, 'ch-port') : undefined,
      chConnectTimeout: raw.chConnectTimeout
        ? coerceNumber(raw.chConnectTimeout, 'ch-connect-timeout')
        : undefined,
      chTimeoutS: raw.chTimeoutS ? coerceNumber(raw.chTimeoutS, 'ch-timeout-s') : undefined,
      // (TP/SL policy removed - pure path metrics only)
    }),
    validate: (opts) => backtestBaselineSchema.parse(opts),
    onError: die,
  });

  // V1 Baseline Optimizer command (capital-aware optimization)
  const v1BaselineCmd = backtestCmd
    .command('v1-baseline')
    .description(
      'V1 Baseline Optimizer: capital-aware optimization with finite capital and position constraints'
    )
    .option('--caller-groups <json>', 'JSON array of caller names: ["caller1","caller2"]')
    .requiredOption('--interval <interval>', 'Candle interval (1m, 5m, etc.)')
    .requiredOption('--from <date>', 'Start date (ISO 8601)')
    .requiredOption('--to <date>', 'End date (ISO 8601)')
    .option('--tp-mults <json>', 'JSON array of take-profit multiples: [1.5,2.0,2.5,3.0]')
    .option('--sl-mults <json>', 'JSON array of stop-loss multiples: [0.85,0.90,0.95]')
    .option('--max-hold-hrs <json>', 'JSON array of max hold hours: [48]')
    .option('--initial-capital <number>', 'Initial capital (default: 10000)', '10000')
    .option(
      '--max-allocation-pct <number>',
      'Max allocation per trade (default: 0.04 = 4%)',
      '0.04'
    )
    .option('--max-risk-per-trade <number>', 'Max risk per trade in USD (default: 200)', '200')
    .option('--max-concurrent-positions <number>', 'Max concurrent positions (default: 25)', '25')
    .option('--min-executable-size <number>', 'Minimum executable size in USD (default: 10)', '10')
    .option('--taker-fee-bps <number>', 'Taker fee in basis points', '30')
    .option('--slippage-bps <number>', 'Slippage in basis points', '10')
    .option(
      '--mode <mode>',
      'Evaluation mode: per-caller, grouped, or both (default: both)',
      'both'
    )
    .option('--min-calls <number>', 'Minimum number of calls per caller (default: 0)', '0')
    .option('--filter-collapsed', 'Filter out callers that collapsed capital (default: true)', true)
    .option(
      '--catalog-path <path>',
      'Path to catalog for slice reuse (much faster if slices already exist)'
    )
    .option(
      '--filter-extreme',
      'Filter out callers requiring extreme parameters (default: true)',
      true
    )
    .option('--format <format>', 'Output format (json, table, csv)', 'table');

  defineCommand(v1BaselineCmd, {
    name: 'v1-baseline',
    packageName: 'backtest',
    coerce: (raw) => ({
      ...raw,
      callerGroups: raw.callerGroups
        ? coerceStringArray(raw.callerGroups, 'caller-groups')
        : undefined,
      tpMults: raw.tpMults ? coerceNumberArray(raw.tpMults, 'tp-mults') : undefined,
      slMults: raw.slMults ? coerceNumberArray(raw.slMults, 'sl-mults') : undefined,
      maxHoldHrs: raw.maxHoldHrs ? coerceNumberArray(raw.maxHoldHrs, 'max-hold-hrs') : undefined,
      initialCapital: raw.initialCapital
        ? coerceNumber(raw.initialCapital, 'initial-capital')
        : 10000,
      maxAllocationPct: raw.maxAllocationPct
        ? coerceNumber(raw.maxAllocationPct, 'max-allocation-pct')
        : 0.04,
      maxRiskPerTrade: raw.maxRiskPerTrade
        ? coerceNumber(raw.maxRiskPerTrade, 'max-risk-per-trade')
        : 200,
      maxConcurrentPositions: raw.maxConcurrentPositions
        ? coerceNumber(raw.maxConcurrentPositions, 'max-concurrent-positions')
        : 25,
      minExecutableSize: raw.minExecutableSize
        ? coerceNumber(raw.minExecutableSize, 'min-executable-size')
        : 10,
      takerFeeBps: raw.takerFeeBps ? coerceNumber(raw.takerFeeBps, 'taker-fee-bps') : 30,
      slippageBps: raw.slippageBps ? coerceNumber(raw.slippageBps, 'slippage-bps') : 10,
      minCalls: raw.minCalls ? coerceNumber(raw.minCalls, 'min-calls') : 0,
      filterCollapsed:
        raw.filterCollapsed !== undefined
          ? coerceBoolean(raw.filterCollapsed, 'filter-collapsed')
          : true,
      filterExtreme:
        raw.filterExtreme !== undefined ? coerceBoolean(raw.filterExtreme, 'filter-extreme') : true,
    }),
    validate: (opts) => backtestV1BaselineSchema.parse(opts),
    onError: die,
  });
}

// Register command module (side effect)
const backtestModule: PackageCommandModule = {
  packageName: 'backtest',
  description: 'Backtest operations (golden path)',
  commands: [
    {
      name: 'run',
      description: 'Run backtest on strategy',
      schema: backtestRunSchema,
      handler: async (args: unknown, _ctx: unknown) => {
        const opts = args as BacktestRunArgs;
        // Parse dates
        const from = DateTime.fromISO(opts.from);
        const to = DateTime.fromISO(opts.to);

        if (!from.isValid) {
          throw new Error(`Invalid from date: ${opts.from}`);
        }
        if (!to.isValid) {
          throw new Error(`Invalid to date: ${opts.to}`);
        }

        // Load calls from DuckDB (common for both modes)
        const { queryCallsDuckdb, createQueryCallsDuckdbContext } =
          await import('@quantbot/workflows');
        const { getDuckDBPath } = await import('@quantbot/utils');

        const duckdbPath = getDuckDBPath('data/alerts.duckdb');
        const ctx = await createQueryCallsDuckdbContext(duckdbPath);

        // Query calls in date range
        let callsResult: Awaited<ReturnType<typeof queryCallsDuckdb>>;
        try {
          callsResult = await queryCallsDuckdb(
            {
              duckdbPath,
              fromISO: opts.from,
              toISO: opts.to,
              callerName: opts.filter, // Use filter as caller name if provided
              limit: 1000,
            },
            ctx
          );
        } catch (error) {
          // Re-throw ConfigurationError (e.g., view missing) as-is
          if (error instanceof Error && error.name === 'ConfigurationError') {
            throw error;
          }
          const errorMsg = error instanceof Error ? error.message : String(error);
          if (
            errorMsg.includes('canon.alerts_std') ||
            errorMsg.includes('alerts_std') ||
            errorMsg.includes('user_calls_d')
          ) {
            throw new Error(
              `Missing canon.alerts_std view in DuckDB. This is the canonical alert contract.\n\n` +
                `Please ensure the canonical schema is set up. The view should be created by the ingestion pipeline.\n` +
                `Database path: ${duckdbPath}\n\n` +
                `Note: user_calls_d has been replaced with canon.alerts_std (the canonical alert contract).`
            );
          }
          throw error;
        }

        // Check for error in result (workflow returned error but didn't throw)
        if (callsResult.error) {
          const errorMsg = callsResult.error;
          if (
            errorMsg.includes('canon.alerts_std') ||
            errorMsg.includes('alerts_std') ||
            errorMsg.includes('user_calls_d')
          ) {
            throw new Error(
              `Missing canon.alerts_std view in DuckDB. This is the canonical alert contract.\n\n` +
                `Please ensure the canonical schema is set up. The view should be created by the ingestion pipeline.\n` +
                `Database path: ${duckdbPath}\n\n` +
                `Note: user_calls_d has been replaced with canon.alerts_std (the canonical alert contract).`
            );
          }
          throw new Error(`Failed to query calls: ${errorMsg}`);
        }

        if (callsResult.calls.length === 0) {
          throw new Error(
            `No calls found in the specified date range (${opts.from} to ${opts.to}).\n` +
              `Database path: ${duckdbPath}\n` +
              `Try:\n` +
              `  1. Check the date range matches your ingested data\n` +
              `  2. Verify calls exist: quantbot calls list --from ${opts.from} --to ${opts.to}\n` +
              `  3. Ingest more data: quantbot ingestion telegram --file <telegram-export.json>`
          );
        }

        // Route based on strategy mode
        if (opts.strategy === 'path-only') {
          // Path-only mode (Guardrail 2): Truth layer only
          // Compute and persist path metrics without policy execution
          const { runPathOnly } = await import('@quantbot/backtest');

          const summary = await runPathOnly({
            calls: callsResult.calls.map((call) => ({
              id: call.id,
              caller: call.caller,
              mint: call.mint as import('@quantbot/core').TokenAddress,
              createdAt: call.createdAt,
            })),
            interval: opts.interval as import('@quantbot/backtest').Interval,
            from,
            to,
            activityMovePct: opts.activityMovePct,
          });

          return {
            runId: summary.runId,
            mode: 'path-only',
            callsProcessed: summary.callsProcessed,
            callsExcluded: summary.callsExcluded,
            pathMetricsWritten: summary.pathMetricsWritten,
          };
        } else if (opts.strategy === 'exit-stack') {
          // Exit-stack mode: use runExitStack()
          if (!opts.strategyId) {
            throw new Error('--strategy-id is required when --strategy exit-stack');
          }
          if (!opts.runId) {
            throw new Error('--run-id is required when --strategy exit-stack');
          }

          // Import exit-stack functions
          const { runExitStack } = await import('@quantbot/backtest');
          const { openDuckDb } = await import('@quantbot/infra/storage');
          const { planBacktest } = await import('@quantbot/backtest');
          const { checkCoverage } = await import('@quantbot/backtest');
          const { materialiseSlice } = await import('@quantbot/backtest');
          const { loadCandlesFromSlice } = await import('@quantbot/backtest');

          // Build a minimal BacktestRequest for planning/slicing
          const strategy: import('@quantbot/backtest').StrategyV1 = {
            id: opts.strategyId,
            name: opts.strategyId,
            overlays: [], // Not used in exit-stack
            fees: {
              takerFeeBps: opts.takerFeeBps || 30,
              slippageBps: opts.slippageBps || 10,
            },
            position: {
              notionalUsd: opts.positionUsd || 1000,
            },
          };

          const request: import('@quantbot/backtest').BacktestRequest = {
            strategy,
            calls: callsResult.calls.map((call) => ({
              id: call.id,
              caller: call.caller,
              mint: call.mint as import('@quantbot/core').TokenAddress,
              createdAt: call.createdAt,
            })),
            interval: opts.interval as import('@quantbot/backtest').Interval,
            from,
            to,
          };

          // Plan and coverage (reuse existing logic)
          const plan = planBacktest(request);
          const coverage = await checkCoverage(plan);
          if (coverage.eligible.length === 0) {
            throw new Error('No eligible calls after coverage check');
          }

          // Try to load from existing parquet files first (much faster)
          const parquetBasePath =
            process.env.PARQUET_BASE_PATH || '/home/memez/backups/quantbot/daily-2025-12-30';
          const { loadCandlesFromExistingParquet } = await import('@quantbot/backtest');

          let candlesByCallId: Map<string, import('@quantbot/core').Candle[]>;
          try {
            // Load from existing day-partitioned parquet files
            const candlesByToken = await loadCandlesFromExistingParquet(
              parquetBasePath,
              from,
              to,
              opts.interval
            );

            // Map candles to calls based on token_address, chain, and time window
            candlesByCallId = new Map<string, import('@quantbot/core').Candle[]>();
            for (const eligible of coverage.eligible) {
              const window = plan.perCallWindow.find((w) => w.callId === eligible.callId);
              if (!window) continue;

              const tokenKey = `${eligible.tokenAddress}:${eligible.chain}`;
              const tokenCandles = candlesByToken.get(tokenKey) || [];

              // Filter candles to call's time window
              const callCandles = tokenCandles.filter((c: import('@quantbot/core').Candle) => {
                const candleTime = DateTime.fromSeconds(c.timestamp);
                return candleTime >= window.from && candleTime <= window.to;
              });

              if (callCandles.length > 0) {
                candlesByCallId.set(eligible.callId, callCandles);
              }
            }
          } catch (error) {
            // Fallback: materialiseSlice (queries ClickHouse)
            const { logger } = await import('@quantbot/utils');
            logger.warn('Failed to load from existing parquet, falling back to ClickHouse', {
              error: error instanceof Error ? error.message : String(error),
            });
            const { materialiseSlice } = await import('@quantbot/backtest');
            const { loadCandlesFromSlice } = await import('@quantbot/backtest');
            const slice = await materialiseSlice(plan, coverage);
            candlesByCallId = await loadCandlesFromSlice(slice.path);
          }

          // Filter calls to only eligible ones
          const eligibleCalls = callsResult.calls.filter((c: any) =>
            coverage.eligible.some((e) => e.callId === c.id)
          );

          // Extract chain info from calls (default to solana since CallRecord doesn't have chain)
          const chainByCallId = new Map<string, string>();
          for (const call of eligibleCalls as any[]) {
            chainByCallId.set(call.id, 'solana');
          }

          const callRecords = eligibleCalls.map((call: any) => ({
            callId: call.id,
            caller: call.caller,
            mint: String(call.mint),
            chain: (chainByCallId.get(call.id) || 'solana') as any,
            callTsMs: call.createdAt.toMillis(),
          }));

          // Resolve DuckDB path from args or env (composition root - allowed here)
          const duckdbPathRaw = process.env.DUCKDB_PATH || 'data/quantbot.duckdb';
          const duckdbPath = pathResolve(duckdbPathRaw);

          // Open main DuckDB (not artifacts directory)
          const db = await openDuckDb(duckdbPath);

          // Run exit-stack
          await runExitStack(db as any, {
            runId: opts.runId!,
            strategyId: opts.strategyId,
            interval: opts.interval,
            entryDelayMs: plan.entryDelayCandles * plan.intervalSeconds * 1000,
            positionUsd: opts.positionUsd || 1000,
            takerFeeBps: opts.takerFeeBps || 30,
            slippageBps: opts.slippageBps || 10,
            calls: callRecords,
            candlesByCallId,
          });

          return {
            runId: opts.runId,
            message: 'Exit-stack backtest completed',
            callsProcessed: eligibleCalls.length,
          };
        } else {
          // Original exit-optimizer mode (existing behavior)
          const strategy: import('@quantbot/backtest').StrategyV1 = {
            id: opts.strategy,
            name: opts.strategy,
            overlays: [
              { kind: 'take_profit', takePct: 100 },
              { kind: 'stop_loss', stopPct: 20 },
            ],
            fees: {
              takerFeeBps: opts.takerFeeBps || 30,
              slippageBps: opts.slippageBps || 10,
            },
            position: {
              notionalUsd: opts.positionUsd || 1000,
            },
          };

          const request: import('@quantbot/backtest').BacktestRequest = {
            strategy,
            calls: callsResult.calls.map((call) => ({
              id: call.id,
              caller: call.caller,
              mint: call.mint as import('@quantbot/core').TokenAddress,
              createdAt: call.createdAt,
            })),
            interval: opts.interval as import('@quantbot/backtest').Interval,
            from,
            to,
          };

          const result = await runBacktest(request);
          return result;
        }
      },
    },
    {
      name: 'callers',
      description: 'Show caller path metrics report for a backtest run',
      schema: backtestCallersSchema,
      handler: async (args: unknown, _ctx: unknown) => {
        const opts = args as BacktestCallersArgs;

        // Locate DuckDB file
        const duckdbPath = join(
          process.cwd(),
          'artifacts',
          'backtest',
          opts.runId,
          'results.duckdb'
        );

        if (!existsSync(duckdbPath)) {
          throw new Error(
            `Backtest results not found for run ID: ${opts.runId}\nExpected path: ${duckdbPath}`
          );
        }

        // Open DuckDB connection
        const duckdb = await import('duckdb');
        const database = new duckdb.Database(duckdbPath);
        const db = database.connect();

        try {
          // Get caller path report
          const { getCallerPathReport } = await import('@quantbot/backtest');
          const adapter = createDuckDbAdapter(db);
          const rows = await getCallerPathReport(adapter, opts.runId);

          if (rows.length === 0) {
            return { message: 'No caller data found for this run' };
          }

          // Sort results
          const sortField = opts.sort || 'count_4x';
          const sorted = [...rows].sort((a, b) => {
            const aVal = a[sortField as keyof typeof a];
            const bVal = b[sortField as keyof typeof b];

            // Handle null values
            if (aVal === null || aVal === undefined) return 1;
            if (bVal === null || bVal === undefined) return -1;

            // Numeric comparison
            if (typeof aVal === 'number' && typeof bVal === 'number') {
              return bVal - aVal; // Descending
            }

            return String(bVal).localeCompare(String(aVal));
          });

          // Format for output - convert to display-friendly format
          const formatted = sorted.map((row) => ({
            caller_name: row.caller_name,
            calls: row.calls,
            count_2x: row.count_2x,
            count_3x: row.count_3x,
            count_4x: row.count_4x,
            failures_2x: row.failures_2x,
            p_hit_2x: row.p_hit_2x ? (row.p_hit_2x * 100).toFixed(1) + '%' : null,
            p_hit_3x: row.p_hit_3x ? (row.p_hit_3x * 100).toFixed(1) + '%' : null,
            p_hit_4x: row.p_hit_4x ? (row.p_hit_4x * 100).toFixed(1) + '%' : null,
            median_t2x_min: row.median_t2x_min ? row.median_t2x_min.toFixed(1) : null,
            median_t3x_min: row.median_t3x_min ? row.median_t3x_min.toFixed(1) : null,
            median_t4x_min: row.median_t4x_min ? row.median_t4x_min.toFixed(1) : null,
            avg_dd_bps: row.avg_dd_bps ? row.avg_dd_bps.toFixed(0) : null,
            avg_dd_to_2x_bps: row.avg_dd_to_2x_bps ? row.avg_dd_to_2x_bps.toFixed(0) : null,
            median_alert_to_activity_s: row.median_alert_to_activity_s
              ? row.median_alert_to_activity_s.toFixed(1)
              : null,
            avg_peak_multiple: row.avg_peak_multiple
              ? row.avg_peak_multiple.toFixed(2) + 'x'
              : null,
          }));

          return formatted;
        } finally {
          database.close();
        }
      },
    },
    {
      name: 'list',
      description: 'List all past backtest runs with aggregates',
      schema: backtestListSchema,
      handler: async (args: unknown, _ctx: unknown) => {
        const opts = args as BacktestListArgs;

        const { getAllRunSummaries } = await import('@quantbot/backtest');
        const summaries = await getAllRunSummaries();

        if (summaries.length === 0) {
          return { message: 'No backtest runs found' };
        }

        // Format for display
        const formatted = summaries.map((row) => ({
          run_id: row.run_id,
          total_trades: row.total_trades,
          total_pnl_usd: row.total_pnl_usd.toFixed(2),
          total_pnl_pct: row.total_pnl_pct.toFixed(2) + '%',
          avg_return_bps: row.avg_return_bps.toFixed(1),
          win_rate: (row.win_rate * 100).toFixed(1) + '%',
          max_drawdown_bps: row.max_drawdown_bps.toFixed(0),
          median_drawdown_bps: row.median_drawdown_bps ? row.median_drawdown_bps.toFixed(0) : null,
          total_calls: row.total_calls,
          unique_callers: row.unique_callers,
          created_at: row.created_at || null,
        }));

        return formatted;
      },
    },
    {
      name: 'leaderboard',
      description: 'Show caller leaderboard based on PnL% with drawdown sorting',
      schema: backtestLeaderboardSchema,
      handler: async (args: unknown, _ctx: unknown) => {
        const opts = args as BacktestLeaderboardArgs;

        if (opts.runId) {
          // Single run leaderboard
          const duckdbPath = join(
            process.cwd(),
            'artifacts',
            'backtest',
            opts.runId,
            'results.duckdb'
          );

          if (!existsSync(duckdbPath)) {
            throw new Error(
              `Backtest results not found for run ID: ${opts.runId}\nExpected path: ${duckdbPath}`
            );
          }

          const duckdb = await import('duckdb');
          const database = new duckdb.Database(duckdbPath);
          const db = database.connect();

          try {
            const { getCallerLeaderboard } = await import('@quantbot/backtest');
            const adapter = createDuckDbAdapter(db);
            const rows = await getCallerLeaderboard(adapter, opts.runId, opts.minCalls || 20);

            if (rows.length === 0) {
              return {
                message: `No caller data found for this run (min calls: ${opts.minCalls || 20})`,
              };
            }

            // Format for display
            const formatted = rows.map((row) => ({
              caller_name: row.caller_name,
              calls: row.calls,
              agg_pnl_pct_sum: row.agg_pnl_pct_sum.toFixed(2) + '%',
              avg_pnl_pct: row.avg_pnl_pct.toFixed(2) + '%',
              median_pnl_pct: row.median_pnl_pct.toFixed(2) + '%',
              strike_rate: (row.strike_rate * 100).toFixed(1) + '%',
              wins: row.wins,
              losses: row.losses,
              median_drawdown_bps: row.median_drawdown_bps
                ? row.median_drawdown_bps.toFixed(0)
                : null,
              avg_drawdown_bps: row.avg_drawdown_bps ? row.avg_drawdown_bps.toFixed(0) : null,
              total_drawdown_bps: row.total_drawdown_bps ? row.total_drawdown_bps.toFixed(0) : null,
              count_2x: row.count_2x,
              count_3x: row.count_3x,
              count_4x: row.count_4x,
            }));

            return formatted;
          } finally {
            database.close();
          }
        } else {
          // Aggregate across all runs
          const { scanBacktestRuns } = await import('@quantbot/backtest');
          const runIds = await scanBacktestRuns();
          const baseDir = join(process.cwd(), 'artifacts', 'backtest');

          const duckdb = await import('duckdb');
          const allLeaderboardRows = new Map<
            string,
            {
              caller_name: string;
              calls: number;
              agg_pnl_pct_sum: number;
              avg_pnl_pct: number;
              median_pnl_pct_array: number[];
              strike_rate: number;
              wins: number;
              losses: number;
              max_drawdown_bps: number;
              median_drawdown_bps_array: number[];
              total_drawdown_bps: number;
              count_2x: number;
              count_3x: number;
              count_4x: number;
            }
          >();

          // Query each run and aggregate
          for (const runId of runIds) {
            const duckdbPath = join(baseDir, runId, 'results.duckdb');
            if (!existsSync(duckdbPath)) continue;

            try {
              const database = new duckdb.Database(duckdbPath);
              const db = database.connect();

              try {
                const { getCallerLeaderboard } = await import('@quantbot/backtest');
                const adapter = createDuckDbAdapter(db);
                const rows = await getCallerLeaderboard(adapter, runId, 0); // Don't filter minCalls during aggregation

                for (const row of rows) {
                  const existing = allLeaderboardRows.get(row.caller_name);
                  if (existing) {
                    const oldCalls = existing.calls;
                    existing.calls += row.calls;
                    existing.agg_pnl_pct_sum += row.agg_pnl_pct_sum;
                    existing.avg_pnl_pct =
                      (existing.avg_pnl_pct * oldCalls + row.avg_pnl_pct * row.calls) /
                      existing.calls;
                    existing.median_pnl_pct_array.push(
                      ...Array(row.calls).fill(row.median_pnl_pct)
                    );
                    existing.strike_rate =
                      (existing.strike_rate * oldCalls + row.strike_rate * row.calls) /
                      existing.calls;
                    existing.wins += row.wins;
                    existing.losses += row.losses;
                    existing.max_drawdown_bps = Math.min(
                      existing.max_drawdown_bps,
                      row.median_drawdown_bps ?? Infinity
                    );
                    existing.median_drawdown_bps_array.push(row.median_drawdown_bps ?? 0);
                    existing.total_drawdown_bps =
                      (existing.total_drawdown_bps ?? 0) + (row.total_drawdown_bps ?? 0);
                    existing.count_2x = (existing.count_2x ?? 0) + (row.count_2x ?? 0);
                    existing.count_3x = (existing.count_3x ?? 0) + (row.count_3x ?? 0);
                    existing.count_4x = (existing.count_4x ?? 0) + (row.count_4x ?? 0);
                  } else {
                    allLeaderboardRows.set(row.caller_name, {
                      caller_name: row.caller_name,
                      calls: row.calls,
                      agg_pnl_pct_sum: row.agg_pnl_pct_sum,
                      avg_pnl_pct: row.avg_pnl_pct,
                      median_pnl_pct_array: Array(row.calls).fill(row.median_pnl_pct),
                      strike_rate: row.strike_rate,
                      wins: row.wins,
                      losses: row.losses,
                      max_drawdown_bps: row.median_drawdown_bps ?? Infinity,
                      median_drawdown_bps_array: [row.median_drawdown_bps ?? 0],
                      total_drawdown_bps: row.total_drawdown_bps ?? 0,
                      count_2x: row.count_2x ?? 0,
                      count_3x: row.count_3x ?? 0,
                      count_4x: row.count_4x ?? 0,
                    });
                  }
                }
              } finally {
                database.close();
              }
            } catch (error) {
              // Skip runs that can't be opened
              console.warn(
                `Warning: Could not read run ${runId} for leaderboard: ${error instanceof Error ? error.message : String(error)}`
              );
            }
          }

          // Filter by minCalls and compute medians
          const filtered = Array.from(allLeaderboardRows.values()).filter(
            (entry) => entry.calls >= (opts.minCalls || 20)
          );

          if (filtered.length === 0) {
            return {
              message: `No callers found with >= ${opts.minCalls || 20} calls across all runs`,
            };
          }

          // Convert to array, compute medians, and sort
          const rows = filtered.map((entry) => {
            const medianPnlPct =
              entry.median_pnl_pct_array.length > 0
                ? entry.median_pnl_pct_array.sort((a, b) => a - b)[
                    Math.floor(entry.median_pnl_pct_array.length / 2)
                  ]!
                : 0;

            const medianDrawdown =
              entry.median_drawdown_bps_array.length > 0
                ? entry.median_drawdown_bps_array.sort((a, b) => a - b)[
                    Math.floor(entry.median_drawdown_bps_array.length / 2)
                  ]!
                : null;

            return {
              caller_name: entry.caller_name,
              calls: entry.calls,
              agg_pnl_pct_sum: entry.agg_pnl_pct_sum,
              avg_pnl_pct: entry.avg_pnl_pct,
              median_pnl_pct: medianPnlPct,
              strike_rate: entry.strike_rate,
              wins: entry.wins,
              losses: entry.losses,
              median_drawdown_bps: medianDrawdown,
              avg_drawdown_bps:
                entry.median_drawdown_bps_array.length > 0
                  ? entry.median_drawdown_bps_array.reduce((a, b) => a + b, 0) /
                    entry.median_drawdown_bps_array.length
                  : null,
              total_drawdown_bps: entry.total_drawdown_bps > 0 ? entry.total_drawdown_bps : null,
              count_2x: entry.count_2x,
              count_3x: entry.count_3x,
              count_4x: entry.count_4x,
            };
          });

          // Sort by: agg_pnl_pct_sum DESC, strike_rate DESC, median_drawdown_bps DESC, total_drawdown_bps ASC
          rows.sort((a, b) => {
            if (b.agg_pnl_pct_sum !== a.agg_pnl_pct_sum) {
              return b.agg_pnl_pct_sum - a.agg_pnl_pct_sum;
            }
            if (b.strike_rate !== a.strike_rate) {
              return b.strike_rate - a.strike_rate;
            }
            const aMed = a.median_drawdown_bps ?? -Infinity;
            const bMed = b.median_drawdown_bps ?? -Infinity;
            if (bMed !== aMed) {
              return bMed - aMed; // DESC - less negative is better
            }
            const aTotal = a.total_drawdown_bps ?? Infinity;
            const bTotal = b.total_drawdown_bps ?? Infinity;
            return aTotal - bTotal; // ASC - less pain is better
          });

          // Format for display
          const formatted = rows.map((row) => ({
            caller_name: row.caller_name,
            calls: row.calls,
            agg_pnl_pct_sum: row.agg_pnl_pct_sum.toFixed(2) + '%',
            avg_pnl_pct: row.avg_pnl_pct.toFixed(2) + '%',
            median_pnl_pct: row.median_pnl_pct.toFixed(2) + '%',
            strike_rate: (row.strike_rate * 100).toFixed(1) + '%',
            wins: row.wins,
            losses: row.losses,
            median_drawdown_bps: row.median_drawdown_bps
              ? row.median_drawdown_bps.toFixed(0)
              : null,
            avg_drawdown_bps: row.avg_drawdown_bps ? row.avg_drawdown_bps.toFixed(0) : null,
            total_drawdown_bps: row.total_drawdown_bps ? row.total_drawdown_bps.toFixed(0) : null,
            count_2x: row.count_2x,
            count_3x: row.count_3x,
            count_4x: row.count_4x,
          }));

          return formatted;
        }
      },
    },
    {
      name: 'truth-leaderboard',
      description: 'Show caller leaderboard from path metrics only (truth layer)',
      schema: backtestTruthLeaderboardSchema,
      handler: async (args: unknown, _ctx: unknown) => {
        const opts = args as BacktestTruthLeaderboardArgs;

        // Find the DuckDB file for this run
        const duckdbPath = join(
          process.cwd(),
          'artifacts',
          'backtest',
          opts.runId,
          'results.duckdb'
        );

        if (!existsSync(duckdbPath)) {
          throw new Error(
            `Backtest results not found for run ID: ${opts.runId}\nExpected path: ${duckdbPath}`
          );
        }

        const duckdb = await import('duckdb');
        const database = new duckdb.Database(duckdbPath);
        const db = database.connect();

        try {
          const { aggregatePathMetricsByCaller } = await import('@quantbot/backtest');

          const adapter = {
            run(sql: string, params: unknown[], callback: (err: unknown) => void): void {
              db.run(sql, params, callback);
            },
            all<T = unknown>(
              sql: string,
              params: unknown[],
              callback: (err: unknown, rows: T[]) => void
            ): void {
              (
                db.all as (
                  sql: string,
                  params: unknown[],
                  cb: (err: unknown, rows: unknown) => void
                ) => void
              )(sql, params, (err: unknown, rows: unknown) => {
                if (err) {
                  callback(err, []);
                } else {
                  callback(null, rows as T[]);
                }
              });
            },
          };

          const rows = await aggregatePathMetricsByCaller(adapter, opts.runId, opts.minCalls || 0);

          if (rows.length === 0) {
            return {
              message: `No caller data found for run ${opts.runId} (min calls: ${opts.minCalls || 0})`,
            };
          }

          // Format for display
          type CallerRow = (typeof rows)[0];
          const formatted = rows.map((row: CallerRow) => ({
            caller_name: row.caller_name,
            calls: row.calls,
            // Hit rates as percentages
            p_hit_2x: (row.p_hit_2x * 100).toFixed(1) + '%',
            p_hit_3x: (row.p_hit_3x * 100).toFixed(1) + '%',
            p_hit_4x: (row.p_hit_4x * 100).toFixed(1) + '%',
            // Counts
            count_2x: row.count_2x,
            count_3x: row.count_3x,
            count_4x: row.count_4x,
            failures_2x: row.failures_2x,
            // Time metrics (already in minutes/seconds)
            median_t2x_min: row.median_t2x_min?.toFixed(1) ?? '-',
            median_t3x_min: row.median_t3x_min?.toFixed(1) ?? '-',
            median_t4x_min: row.median_t4x_min?.toFixed(1) ?? '-',
            median_activity_s: row.median_alert_to_activity_s?.toFixed(0) ?? '-',
            // Peak metrics
            median_peak: row.median_peak_multiple?.toFixed(2) ?? '-',
            avg_peak: row.avg_peak_multiple?.toFixed(2) ?? '-',
            // Drawdown metrics (bps)
            median_dd_bps: row.median_dd_bps?.toFixed(0) ?? '-',
            p95_dd_bps: row.p95_dd_bps?.toFixed(0) ?? '-',
            // Slow activity rate
            slow_rate: ((row.slow_activity_rate ?? 0) * 100).toFixed(1) + '%',
          }));

          return formatted;
        } finally {
          database.close();
        }
      },
    },
    {
      name: 'policy',
      description: 'Execute a risk policy against calls with candle replay',
      schema: backtestPolicySchema,
      handler: async (args: unknown, _ctx: unknown) => {
        const opts = args as BacktestPolicyArgs;

        // Parse dates
        const from = DateTime.fromISO(opts.from);
        const to = DateTime.fromISO(opts.to);

        if (!from.isValid) {
          throw new Error(`Invalid from date: ${opts.from}`);
        }
        if (!to.isValid) {
          throw new Error(`Invalid to date: ${opts.to}`);
        }

        // Parse policy JSON
        let policy: import('@quantbot/backtest').RiskPolicy;
        try {
          const { parseRiskPolicy } = await import('@quantbot/backtest');
          policy = parseRiskPolicy(JSON.parse(opts.policyJson));
        } catch (err) {
          throw new Error(
            `Invalid policy JSON: ${err instanceof Error ? err.message : String(err)}`
          );
        }

        // Generate policy ID if not provided
        const policyId = opts.policyId || `${policy.kind}-${Date.now()}`;

        // Load calls from DuckDB
        const { queryCallsDuckdb, createQueryCallsDuckdbContext } =
          await import('@quantbot/workflows');
        const { getDuckDBPath } = await import('@quantbot/utils');

        const duckdbPath = getDuckDBPath('data/alerts.duckdb');
        const ctx = await createQueryCallsDuckdbContext(duckdbPath);

        const callsResult = await queryCallsDuckdb(
          {
            duckdbPath,
            fromISO: opts.from,
            toISO: opts.to,
            callerName: opts.filter,
            limit: 1000,
          },
          ctx
        );

        if (callsResult.calls.length === 0) {
          throw new Error('No calls found in the specified date range');
        }

        // Run policy backtest
        const { runPolicyBacktest } = await import('@quantbot/backtest');

        const summary = await runPolicyBacktest({
          policy,
          policyId,
          calls: callsResult.calls.map((call) => ({
            id: call.id,
            caller: call.caller,
            mint: call.mint as import('@quantbot/core').TokenAddress,
            createdAt: call.createdAt,
          })),
          interval: opts.interval as import('@quantbot/backtest').Interval,
          from,
          to,
          fees: {
            takerFeeBps: opts.takerFeeBps,
            slippageBps: opts.slippageBps,
          },
          executionModel: opts.executionModel as import('@quantbot/backtest').ExecutionModelVenue,
          runId: opts.runId,
        });

        return {
          runId: summary.runId,
          policyId: summary.policyId,
          policyKind: policy.kind,
          callsProcessed: summary.callsProcessed,
          callsExcluded: summary.callsExcluded,
          policyResultsWritten: summary.policyResultsWritten,
          metrics: {
            avgReturnBps: summary.metrics.avgReturnBps.toFixed(2),
            medianReturnBps: summary.metrics.medianReturnBps.toFixed(2),
            stopOutRate: (summary.metrics.stopOutRate * 100).toFixed(1) + '%',
            avgTimeExposedMin: (summary.metrics.avgTimeExposedMs / 60000).toFixed(1),
            avgTailCapture: summary.metrics.avgTailCapture?.toFixed(2) ?? 'N/A',
            avgMaxAdverseExcursionBps: summary.metrics.avgMaxAdverseExcursionBps.toFixed(0),
          },
        };
      },
    },
    {
      name: 'optimize',
      description: 'Grid search to find optimal policy for callers',
      schema: backtestOptimizeSchema,
      handler: async (args: unknown, _ctx: unknown) => {
        const opts = args as BacktestOptimizeArgs;

        // Parse dates
        const from = DateTime.fromISO(opts.from);
        const to = DateTime.fromISO(opts.to);

        if (!from.isValid) {
          throw new Error(`Invalid from date: ${opts.from}`);
        }
        if (!to.isValid) {
          throw new Error(`Invalid to date: ${opts.to}`);
        }

        // Load calls from DuckDB
        const { queryCallsDuckdb, createQueryCallsDuckdbContext } =
          await import('@quantbot/workflows');
        const { getDuckDBPath } = await import('@quantbot/utils');

        const duckdbPath = getDuckDBPath('data/alerts.duckdb');
        const ctx = await createQueryCallsDuckdbContext(duckdbPath);

        const callsResult = await queryCallsDuckdb(
          {
            duckdbPath,
            fromISO: opts.from,
            toISO: opts.to,
            callerName: opts.caller,
            limit: 1000,
          },
          ctx
        );

        if (callsResult.calls.length === 0) {
          throw new Error('No calls found in the specified date range');
        }

        // Import optimization functions
        const { optimizePolicy, optimizePolicyPerCaller, formatFollowPlanForDisplay } =
          await import('@quantbot/backtest');

        // Import candle loading and plan/coverage functions
        const { planBacktest, checkCoverage, materialiseSlice, loadCandlesFromSlice } =
          await import('@quantbot/backtest');

        // Build request for planning
        const planReq = {
          strategy: {
            id: 'optimizer',
            name: 'optimizer',
            overlays: [],
            fees: { takerFeeBps: opts.takerFeeBps, slippageBps: opts.slippageBps },
            position: { notionalUsd: 1000 },
            indicatorWarmup: 0,
            entryDelay: 0,
            maxHold: 1440,
          },
          calls: callsResult.calls.map((call) => ({
            id: call.id,
            caller: call.caller,
            mint: call.mint as import('@quantbot/core').TokenAddress,
            createdAt: call.createdAt,
          })),
          interval: opts.interval as import('@quantbot/backtest').Interval,
          from,
          to,
        };

        // Plan and coverage
        const plan = planBacktest(planReq);
        const coverage = await checkCoverage(plan);

        if (coverage.eligible.length === 0) {
          throw new Error('No eligible calls after coverage check');
        }

        // Materialise slice and load candles
        const slice = await materialiseSlice(plan, coverage);
        const candlesByCallId = await loadCandlesFromSlice(slice.path);

        // Build constraints with optional high-multiple caller relaxation
        const constraints = {
          maxStopOutRate: opts.maxStopOutRate,
          maxP95DrawdownBps: opts.maxP95DrawdownBps,
          maxTimeExposedMs: opts.maxTimeExposedMs,
          ...(opts.enableHighMultipleRelaxation
            ? {
                callerHighMultipleProfile: {
                  p95PeakMultipleThreshold: 20, // Consider caller high-multiple if p95 >= 20x
                  drawdownRelaxationFactor: opts.highMultipleDrawdownRelaxation,
                  stopOutRelaxationFactor: opts.highMultipleStopOutRelaxation,
                },
              }
            : {}),
        };

        const fees = {
          takerFeeBps: opts.takerFeeBps,
          slippageBps: opts.slippageBps,
        };

        // Collect path metrics for caller profile analysis
        // Load path metrics from slice if available
        const pathMetricsByCallId = new Map<string, { peak_multiple?: number | null }>();
        // TODO: Load path metrics from truth layer if available
        // For now, this will be empty and caller profile analysis will use policy results

        // Run optimization
        if (opts.caller) {
          // Single caller optimization
          const result = optimizePolicy({
            calls: planReq.calls,
            candlesByCallId,
            constraints,
            fees,
            callerGroups: opts.callerGroups,
            pathMetricsByCallId,
          });

          if (!result.bestPolicy) {
            return {
              message: 'No feasible policy found within constraints',
              policiesEvaluated: result.policiesEvaluated,
              constraints,
            };
          }

          return {
            caller: opts.caller,
            bestPolicy: result.bestPolicy.policyId,
            score: result.bestPolicy.score.score.toFixed(2),
            medianReturnBps: result.bestPolicy.score.metrics.medianReturnBps.toFixed(0),
            stopOutRate: (result.bestPolicy.score.metrics.stopOutRate * 100).toFixed(1) + '%',
            tailCapture: (result.bestPolicy.score.metrics.avgTailCapture * 100).toFixed(0) + '%',
            policiesEvaluated: result.policiesEvaluated,
            feasiblePolicies: result.feasiblePolicies,
            policyJson: JSON.stringify(result.bestPolicy.policy),
          };
        } else {
          // Per-caller optimization (with optional caller group filtering)
          let callsForOptimization = planReq.calls;
          if (opts.callerGroups && opts.callerGroups.length > 0) {
            callsForOptimization = planReq.calls.filter((call) =>
              opts.callerGroups!.includes(call.caller)
            );
          }

          const perCallerResults = optimizePolicyPerCaller(
            callsForOptimization,
            candlesByCallId,
            constraints,
            fees
          );

          const results = [];
          for (const [caller, optimalPolicy] of perCallerResults) {
            if (optimalPolicy) {
              results.push({
                caller,
                policyId: optimalPolicy.policyId,
                score: optimalPolicy.score.score.toFixed(2),
                medianReturnBps: optimalPolicy.score.metrics.medianReturnBps.toFixed(0),
                stopOutRate: (optimalPolicy.score.metrics.stopOutRate * 100).toFixed(1) + '%',
                count: optimalPolicy.score.metrics.count,
              });
            } else {
              results.push({
                caller,
                policyId: 'none',
                score: '-',
                medianReturnBps: '-',
                stopOutRate: '-',
                count: 0,
              });
            }
          }

          // Sort by score descending
          results.sort((a, b) => {
            const aScore = a.score === '-' ? -Infinity : parseFloat(a.score);
            const bScore = b.score === '-' ? -Infinity : parseFloat(b.score);
            return bScore - aScore;
          });

          return results;
        }
      },
    },
    {
      name: 'baseline',
      description: 'Run baseline per-alert backtest (ATH, drawdowns, time-to-2x, TP/SL)',
      schema: backtestBaselineSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const { baselineBacktestHandler } = await import('../handlers/backtest/baseline.js');
        const { CommandContext } = await import('../core/command-context.js');
        return baselineBacktestHandler(
          args as BacktestBaselineArgs,
          ctx as InstanceType<typeof CommandContext>
        );
      },
      examples: [
        'quantbot backtest baseline',
        'quantbot backtest baseline --from 2025-05-01 --to 2025-05-31',
        'quantbot backtest baseline --horizon-hours 120',
        'quantbot backtest baseline --tui',
      ],
    },
    {
      name: 'v1-baseline',
      description: 'V1 Baseline Optimizer: capital-aware optimization with finite capital',
      schema: backtestV1BaselineSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const { v1BaselineOptimizerHandler } =
          await import('../handlers/backtest/v1-baseline-optimizer.js');
        const { CommandContext } = await import('../core/command-context.js');
        return v1BaselineOptimizerHandler(
          args as BacktestV1BaselineArgs,
          ctx as InstanceType<typeof CommandContext>
        );
      },
      examples: [
        'quantbot backtest v1-baseline --from 2025-05-01 --to 2025-05-31 --interval 5m',
        'quantbot backtest v1-baseline --from 2025-05-01 --to 2025-05-31 --interval 5m --mode per-caller --min-calls 50',
        'quantbot backtest v1-baseline --from 2025-05-01 --to 2025-05-31 --interval 5m --mode grouped --min-calls 50',
      ],
    },
    {
      name: 'catalog-sync',
      description: 'Sync completed backtest runs to catalog (daemon operation)',
      schema: catalogSyncSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const { catalogSyncHandler } = await import('../handlers/backtest/catalog-sync.js');
        const { CommandContext } = await import('../core/command-context.js');
        return catalogSyncHandler(
          args as CatalogSyncArgs,
          ctx as InstanceType<typeof CommandContext>
        );
      },
      examples: [
        'quantbot backtest catalog-sync',
        'quantbot backtest catalog-sync --base-dir runs --duckdb data/backtest_catalog.duckdb',
        'quantbot backtest catalog-sync --stats',
      ],
    },
    {
      name: 'catalog-query',
      description: 'Query the backtest catalog for runs matching criteria',
      schema: catalogQuerySchema,
      handler: async (args: unknown, ctx: unknown) => {
        const { catalogQueryHandler } = await import('../handlers/backtest/catalog-query.js');
        const { CommandContext } = await import('../core/command-context.js');
        return catalogQueryHandler(
          args as CatalogQueryArgs,
          ctx as InstanceType<typeof CommandContext>
        );
      },
      examples: [
        'quantbot backtest catalog-query --limit 10',
        'quantbot backtest catalog-query --run-type path-only --status completed',
        'quantbot backtest catalog-query --git-branch main --limit 20',
        'quantbot backtest catalog-query --run-id <uuid> --artifact-type paths',
      ],
    },
  ],
};

commandRegistry.registerPackage(backtestModule);
