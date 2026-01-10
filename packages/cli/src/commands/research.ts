/**
 * Research Commands
 */

import type { Command } from 'commander';
import { z } from 'zod';
import type { PackageCommandModule } from '../types/index.js';
import { commandRegistry } from '../core/command-registry.js';
import { defineCommand } from '../core/defineCommand.js';
import { die } from '../core/cliErrors.js';
import { coerceNumber } from '../core/coerce.js';
import type { CommandContext } from '../core/command-context.js';
import { listRunsHandler } from '../handlers/research/list-runs.js';
import { showRunHandler } from '../handlers/research/show-run.js';
import { runSimulationHandler } from '../handlers/research/run-simulation.js';
import { replaySimulationHandler } from '../handlers/research/replay-simulation.js';
import { replayManifestHandler } from '../handlers/research/replay-manifest.js';
import { batchSimulationHandler } from '../handlers/research/batch-simulation.js';
import { sweepSimulationHandler } from '../handlers/research/sweep-simulation.js';
import { createSnapshotHandler } from '../handlers/research/create-snapshot.js';
import { createExecutionModelHandler } from '../handlers/research/create-execution-model.js';
import { createCostModelHandler } from '../handlers/research/create-cost-model.js';
import { createRiskModelHandler } from '../handlers/research/create-risk-model.js';
import { leaderboardHandler } from '../handlers/research/leaderboard.js';
import {
  researchListSchema,
  researchShowSchema,
  researchRunSchema,
  researchReplaySchema,
  researchReplayManifestSchema,
  researchBatchSchema,
  researchSweepSchema,
  createSnapshotSchema,
  createExecutionModelSchema,
  createCostModelSchema,
  createRiskModelSchema,
  researchLeaderboardSchema,
} from '../command-defs/research.js';

/**
 * Register research commands
 */
export function registerResearchCommands(program: Command): void {
  const researchCmd = program.command('research').description('Research OS experiment management');

  // List command
  const listCmd = researchCmd
    .command('list')
    .description('List all simulation runs')
    .option('--limit <n>', 'Maximum number of runs to list')
    .option('--offset <n>', 'Offset for pagination')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(listCmd, {
    name: 'list',
    packageName: 'research',
    coerce: (raw) => ({
      ...raw,
      limit: raw.limit ? coerceNumber(raw.limit, 'limit') : undefined,
      offset: raw.offset ? coerceNumber(raw.offset, 'offset') : undefined,
    }),
    validate: (opts) => researchListSchema.parse(opts),
    onError: die,
  });

  // Show command
  const showCmd = researchCmd
    .command('show')
    .description('Show details of a specific simulation run')
    .requiredOption('--run-id <id>', 'Run ID to show')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(showCmd, {
    name: 'show',
    packageName: 'research',
    validate: (opts) => researchShowSchema.parse(opts),
    onError: die,
  });

  // Leaderboard command
  const leaderboardCmd = researchCmd
    .command('leaderboard')
    .description('Show leaderboard of simulation runs ranked by metrics')
    .option('--criteria <criteria>', 'Ranking criteria', 'return')
    .option('--order <order>', 'Sort order (asc/desc)', 'desc')
    .option('--limit <n>', 'Maximum number of results')
    .option('--strategy-name <name>', 'Filter by strategy name')
    .option('--snapshot-id <id>', 'Filter by snapshot ID')
    .option('--min-return <n>', 'Minimum return threshold')
    .option('--min-win-rate <n>', 'Minimum win rate threshold (0-1)')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(leaderboardCmd, {
    name: 'leaderboard',
    packageName: 'research',
    coerce: (raw) => ({
      ...raw,
      limit: raw.limit ? coerceNumber(raw.limit, 'limit') : undefined,
      minReturn: raw.minReturn ? coerceNumber(raw.minReturn, 'minReturn') : undefined,
      minWinRate: raw.minWinRate ? coerceNumber(raw.minWinRate, 'minWinRate') : undefined,
    }),
    validate: (opts) => researchLeaderboardSchema.parse(opts),
    onError: die,
  });

  // Run command
  const runCmd = researchCmd
    .command('run')
    .description('Run a single simulation from a request JSON file')
    .requiredOption('--request-file <path>', 'Path to SimulationRequest JSON file')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(runCmd, {
    name: 'run',
    packageName: 'research',
    validate: (opts) => researchRunSchema.parse(opts),
    onError: die,
  });

  // Replay command
  const replayCmd = researchCmd
    .command('replay')
    .description('Replay a simulation by run ID')
    .requiredOption('--run-id <id>', 'Run ID to replay')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(replayCmd, {
    name: 'replay',
    packageName: 'research',
    validate: (opts) => researchReplaySchema.parse(opts),
    onError: die,
  });

  // Replay from manifest command
  const replayManifestCmd = researchCmd
    .command('replay-manifest')
    .description('Replay a simulation from a manifest file (first-class re-run command)')
    .requiredOption('--manifest <path>', 'Path to manifest.json file')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(replayManifestCmd, {
    name: 'replay-manifest',
    packageName: 'research',
    coerce: (raw) => ({
      ...raw,
      manifestFile: raw.manifest, // Map --manifest to manifestFile
    }),
    validate: (opts) => researchReplayManifestSchema.parse(opts),
    onError: die,
  });

  // Batch command
  const batchCmd = researchCmd
    .command('batch')
    .description('Run batch simulations from a batch JSON file')
    .requiredOption('--batch-file <path>', 'Path to BatchSimulationRequest JSON file')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(batchCmd, {
    name: 'batch',
    packageName: 'research',
    validate: (opts) => researchBatchSchema.parse(opts),
    onError: die,
  });

  // Sweep command
  const sweepCmd = researchCmd
    .command('sweep')
    .description('Run parameter sweep from a sweep JSON file')
    .requiredOption('--sweep-file <path>', 'Path to ParameterSweepRequest JSON file')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(sweepCmd, {
    name: 'sweep',
    packageName: 'research',
    validate: (opts) => researchSweepSchema.parse(opts),
    onError: die,
  });

  // Create snapshot command
  const createSnapshotCmd = researchCmd
    .command('create-snapshot')
    .description('Create a data snapshot for simulations')
    .requiredOption('--from <date>', 'Start date (ISO 8601)')
    .requiredOption('--to <date>', 'End date (ISO 8601)')
    .option('--venue <venue>', 'Data source venue', 'pump.fun')
    .option('--chain <chain>', 'Blockchain', 'solana')
    .option('--caller <caller>', 'Caller name filter (can specify multiple)')
    .option('--mint <mint>', 'Mint address filter (can specify multiple)')
    .option('--min-volume <volume>', 'Minimum volume filter')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(createSnapshotCmd, {
    name: 'create-snapshot',
    packageName: 'research',
    coerce: (raw) => ({
      ...raw,
      sources: raw.venue ? [{ venue: raw.venue, chain: raw.chain }] : undefined,
      callerNames: raw.caller ? (Array.isArray(raw.caller) ? raw.caller : [raw.caller]) : undefined,
      mintAddresses: raw.mint ? (Array.isArray(raw.mint) ? raw.mint : [raw.mint]) : undefined,
      minVolume: raw.minVolume ? coerceNumber(raw.minVolume, 'min-volume') : undefined,
    }),
    validate: (opts) => createSnapshotSchema.parse(opts),
    onError: die,
  });

  // Create execution model command
  const createExecutionModelCmd = researchCmd
    .command('create-execution-model')
    .description('Create an execution model from calibration data')
    .option('--latency-samples <samples>', 'Comma-separated latency samples (ms)')
    .option('--slippage-file <path>', 'Path to slippage samples JSON file')
    .option('--failure-rate <rate>', 'Failure rate (0-1)', '0.01')
    .option('--partial-fill-rate <rate>', 'Partial fill rate (0-1)')
    .option('--venue <venue>', 'Trading venue', 'pumpfun')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(createExecutionModelCmd, {
    name: 'create-execution-model',
    packageName: 'research',
    coerce: (raw) => ({
      ...raw,
      latencySamples: raw.latencySamples
        ? (raw.latencySamples as string)
            .split(',')
            .map((s) => coerceNumber(s.trim(), 'latency-sample'))
        : undefined,
      failureRate: raw.failureRate ? coerceNumber(raw.failureRate, 'failure-rate') : undefined,
      partialFillRate: raw.partialFillRate
        ? coerceNumber(raw.partialFillRate, 'partial-fill-rate')
        : undefined,
    }),
    validate: (opts) => createExecutionModelSchema.parse(opts),
    onError: die,
  });

  // Create cost model command
  const createCostModelCmd = researchCmd
    .command('create-cost-model')
    .description('Create a cost model from fee data')
    .option('--base-fee <fee>', 'Base transaction fee (lamports)', '5000')
    .option('--priority-fee-min <fee>', 'Minimum priority fee (micro-lamports/CU)', '1000')
    .option('--priority-fee-max <fee>', 'Maximum priority fee (micro-lamports/CU)', '10000')
    .option('--trading-fee-percent <percent>', 'Trading fee percentage (0-1)', '0.01')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(createCostModelCmd, {
    name: 'create-cost-model',
    packageName: 'research',
    coerce: (raw) => ({
      ...raw,
      baseFee: raw.baseFee ? coerceNumber(raw.baseFee, 'base-fee') : undefined,
      priorityFeeMin: raw.priorityFeeMin
        ? coerceNumber(raw.priorityFeeMin, 'priority-fee-min')
        : undefined,
      priorityFeeMax: raw.priorityFeeMax
        ? coerceNumber(raw.priorityFeeMax, 'priority-fee-max')
        : undefined,
      tradingFeePercent: raw.tradingFeePercent
        ? coerceNumber(raw.tradingFeePercent, 'trading-fee-percent')
        : undefined,
    }),
    validate: (opts) => createCostModelSchema.parse(opts),
    onError: die,
  });

  // Create risk model command
  const createRiskModelCmd = researchCmd
    .command('create-risk-model')
    .description('Create a risk model from constraints')
    .option('--max-drawdown-percent <percent>', 'Maximum drawdown percentage (0-100)', '20')
    .option('--max-loss-per-day <amount>', 'Maximum loss per day (USD)', '1000')
    .option('--max-consecutive-losses <n>', 'Maximum consecutive losses', '5')
    .option('--max-position-size <size>', 'Maximum position size (USD)', '500')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(createRiskModelCmd, {
    name: 'create-risk-model',
    packageName: 'research',
    coerce: (raw) => ({
      ...raw,
      maxDrawdownPercent: raw.maxDrawdownPercent
        ? coerceNumber(raw.maxDrawdownPercent, 'max-drawdown-percent')
        : undefined,
      maxLossPerDay: raw.maxLossPerDay
        ? coerceNumber(raw.maxLossPerDay, 'max-loss-per-day')
        : undefined,
      maxConsecutiveLosses: raw.maxConsecutiveLosses
        ? coerceNumber(raw.maxConsecutiveLosses, 'max-consecutive-losses')
        : undefined,
      maxPositionSize: raw.maxPositionSize
        ? coerceNumber(raw.maxPositionSize, 'max-position-size')
        : undefined,
    }),
    validate: (opts) => createRiskModelSchema.parse(opts),
    onError: die,
  });
}

/**
 * Register as package command module
 */
const researchModule: PackageCommandModule = {
  packageName: 'research',
  description: 'Research OS experiment management',
  commands: [
    {
      name: 'list',
      description: 'List all simulation runs',
      schema: researchListSchema,
      handler: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof researchListSchema>;
        return await listRunsHandler(typedArgs, typedCtx);
      },
      examples: ['quantbot research list', 'quantbot research list --limit 10 --offset 0'],
    },
    {
      name: 'show',
      description: 'Show details of a specific simulation run',
      schema: researchShowSchema,
      handler: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof researchShowSchema>;
        return await showRunHandler(typedArgs, typedCtx);
      },
      examples: ['quantbot research show --run-id run_abc123'],
    },
    {
      name: 'leaderboard',
      description: 'Show leaderboard of simulation runs ranked by metrics',
      schema: researchLeaderboardSchema,
      handler: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof researchLeaderboardSchema>;
        return await leaderboardHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot research leaderboard',
        'quantbot research leaderboard --criteria return --limit 10',
        'quantbot research leaderboard --criteria winRate --strategy-name MyStrategy',
      ],
    },
    {
      name: 'run',
      description: 'Run a single simulation from a request JSON file',
      schema: researchRunSchema,
      handler: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof researchRunSchema>;
        return await runSimulationHandler(typedArgs, typedCtx);
      },
      examples: ['quantbot research run --request-file request.json'],
    },
    {
      name: 'replay',
      description: 'Replay a simulation by run ID',
      schema: researchReplaySchema,
      handler: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof researchReplaySchema>;
        return await replaySimulationHandler(typedArgs, typedCtx);
      },
      examples: ['quantbot research replay --run-id run_abc123'],
    },
    {
      name: 'replay-manifest',
      description: 'Replay a simulation from a manifest file (first-class re-run command)',
      schema: researchReplayManifestSchema,
      handler: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof researchReplayManifestSchema>;
        return await replayManifestHandler(typedArgs, typedCtx);
      },
      examples: ['quantbot research replay-manifest --manifest artifacts/run_abc123/manifest.json'],
    },
    {
      name: 'batch',
      description: 'Run batch simulations from a batch JSON file',
      schema: researchBatchSchema,
      handler: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof researchBatchSchema>;
        return await batchSimulationHandler(typedArgs, typedCtx);
      },
      examples: ['quantbot research batch --batch-file batch.json'],
    },
    {
      name: 'sweep',
      description: 'Run parameter sweep from a sweep JSON file',
      schema: researchSweepSchema,
      handler: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof researchSweepSchema>;
        return await sweepSimulationHandler(typedArgs, typedCtx);
      },
      examples: ['quantbot research sweep --sweep-file sweep.json'],
    },
    {
      name: 'create-snapshot',
      description: 'Create a data snapshot for simulations',
      schema: createSnapshotSchema,
      handler: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof createSnapshotSchema>;
        return await createSnapshotHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot research create-snapshot --from 2024-01-01T00:00:00Z --to 2024-01-02T00:00:00Z',
        'quantbot research create-snapshot --from 2024-01-01T00:00:00Z --to 2024-01-02T00:00:00Z --caller alpha-caller --min-volume 1000',
      ],
    },
    {
      name: 'create-execution-model',
      description: 'Create an execution model from calibration data',
      schema: createExecutionModelSchema,
      handler: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof createExecutionModelSchema>;
        return await createExecutionModelHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot research create-execution-model --latency-samples "100,200,300" --failure-rate 0.01',
      ],
    },
    {
      name: 'create-cost-model',
      description: 'Create a cost model from fee data',
      schema: createCostModelSchema,
      handler: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof createCostModelSchema>;
        return await createCostModelHandler(typedArgs, typedCtx);
      },
      examples: ['quantbot research create-cost-model --base-fee 5000 --trading-fee-percent 0.01'],
    },
    {
      name: 'create-risk-model',
      description: 'Create a risk model from constraints',
      schema: createRiskModelSchema,
      handler: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof createRiskModelSchema>;
        return await createRiskModelHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot research create-risk-model --max-drawdown-percent 20 --max-loss-per-day 1000',
      ],
    },
  ],
};

// Register the module
commandRegistry.registerPackage(researchModule);
