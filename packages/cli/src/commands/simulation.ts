/**
 * Simulation Commands
 */

import type { Command } from 'commander';
import { z } from 'zod';
import { DateTime } from 'luxon';
import {
  StrategiesRepository,
  CallsRepository,
  TokensRepository,
  SimulationRunsRepository,
  SimulationResultsRepository,
} from '@quantbot/storage';
import { fetchHybridCandles } from '@quantbot/ohlcv';
import { simulateStrategy } from '@quantbot/simulation';
import { runSimulation } from '@quantbot/workflows';
import type { WorkflowContext, SimulationRunSpec } from '@quantbot/workflows';
import { logger } from '@quantbot/utils';
import { parseArguments } from '../core/argument-parser';
import { formatOutput } from '../core/output-formatter';
import { handleError } from '../core/error-handler';
import { ensureInitialized } from '../core/initialization-manager';
import type { PackageCommandModule } from '../types';
import { commandRegistry } from '../core/command-registry';

/**
 * Run command schema
 */
const runSchema = z.object({
  strategy: z.string().min(1),
  caller: z.string().optional(),
  from: z.string(),
  to: z.string(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * List runs schema
 */
const listRunsSchema = z.object({
  caller: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().positive().max(1000).default(100),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

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
      try {
        // Initialize storage
        await ensureInitialized();

        const extendedSchema = runSchema.extend({
          interval: z.enum(['1m', '5m', '15m', '1h']).default('1m'),
          preWindow: z.coerce.number().int().min(0).default(0),
          postWindow: z.coerce.number().int().min(0).default(0),
          dryRun: z.boolean().default(false),
          concurrency: z.coerce.number().int().min(1).max(64).default(8),
        });

        const args = parseArguments(extendedSchema, {
          ...options,
          preWindow: options.preWindow ? parseInt(options.preWindow, 10) : 0,
          postWindow: options.postWindow ? parseInt(options.postWindow, 10) : 0,
          concurrency: options.concurrency ? parseInt(options.concurrency, 10) : 8,
          dryRun: options.dryRun === true || options.dryRun === 'true',
        });

        // Build workflow spec
        const spec: SimulationRunSpec = {
          strategyName: args.strategy,
          callerName: args.caller,
          from: args.from,
          to: args.to,
          interval: args.interval,
          preWindowMinutes: args.preWindow,
          postWindowMinutes: args.postWindow,
          dryRun: args.dryRun,
          concurrency: args.concurrency,
        };

        // Build workflow context
        const strategiesRepo = new StrategiesRepository();
        const callsRepo = new CallsRepository();
        const tokensRepo = new TokensRepository();
        const runsRepo = new SimulationRunsRepository();
        const resultsRepo = new SimulationResultsRepository();

        const ctx: WorkflowContext = {
          logger,
          repos: {
            strategies: {
              getByName: async (name: string) => {
                const strategy = await strategiesRepo.findByName(name);
                if (!strategy) return null;
                return { name: strategy.name, config: strategy.config };
              },
            },
            calls: {
              listByRange: async ({ callerName, fromIso, toIso }) => {
                const calls = await callsRepo.queryBySelection({
                  callerNames: callerName ? [callerName] : undefined,
                  from: DateTime.fromISO(fromIso),
                  to: DateTime.fromISO(toIso),
                });

                // Resolve token addresses for each call
                const callsWithMints = await Promise.all(
                  calls.map(async (call) => {
                    const token = await tokensRepo.findById(call.tokenId);
                    return {
                      id: call.id.toString(),
                      mint: token?.address || '',
                      timestampIso: call.signalTimestamp.toISO() || '',
                    };
                  })
                );

                // Filter out calls without valid mints
                return callsWithMints.filter((c) => c.mint.length > 0);
              },
            },
            runs: {
              createRun: async ({ strategyName, callerName, fromIso, toIso, interval, dryRun }) => {
                // For now, create a simple run record
                // In a full implementation, you'd look up strategy/caller IDs
                const runId = await runsRepo.createRun({
                  runType: 'backtest',
                  engineVersion: '1.0.0',
                  configHash: 'cli-run',
                  config: { strategyName, callerName, fromIso, toIso, interval },
                  dataSelection: {},
                  status: 'running',
                });
                return runId.toString();
              },
            },
            results: {
              upsertResult: async ({ runId, callId, mint, pnlMultiple, exitReason, raw }) => {
                await resultsRepo.upsertSummary({
                  simulationRunId: parseInt(runId, 10),
                  finalPnl: pnlMultiple,
                  metadata: { callId, mint, exitReason, raw },
                });
              },
            },
          },
          ohlcv: {
            fetchHybridCandles: async ({
              mint,
              fromIso,
              toIso,
              interval,
              preWindowMinutes,
              postWindowMinutes,
            }) => {
              const from = DateTime.fromISO(fromIso);
              const to = DateTime.fromISO(toIso);
              const alertTime = from; // Use start time as alert time for window expansion

              // Expand windows if needed
              const actualFrom =
                preWindowMinutes > 0 ? from.minus({ minutes: preWindowMinutes }) : from;
              const actualTo = postWindowMinutes > 0 ? to.plus({ minutes: postWindowMinutes }) : to;

              const candles = await fetchHybridCandles(
                mint,
                actualFrom,
                actualTo,
                'solana',
                alertTime
              );
              return candles as unknown[]; // Cast to unknown[] to match context interface
            },
          },
          simulation: {
            simulateOnCandles: async ({ strategyName, strategyConfig, candles, mint, callId }) => {
              // Extract strategy legs from config
              const strategyLegs = (strategyConfig as any).profitTargets || [];
              const stopLoss = (strategyConfig as any).stopLoss;
              const entry = (strategyConfig as any).entry;
              const reEntry = (strategyConfig as any).reEntry;
              const costs = (strategyConfig as any).costs;

              // Run simulation
              const result = await simulateStrategy(
                candles as any, // Cast back to Candle[]
                strategyLegs,
                stopLoss,
                entry,
                reEntry,
                costs
              );

              // Calculate exit reason from events
              const exitEvent = result.events.find(
                (e: any) => e.type === 'exit' || e.type === 'stop_loss'
              );
              const exitReason = exitEvent?.description || 'hold';

              return {
                pnlMultiple: result.finalPnl,
                exitReason,
                raw: {
                  entryPrice: result.entryPrice,
                  finalPrice: result.finalPrice,
                  totalCandles: result.totalCandles,
                },
              };
            },
          },
        };

        // Run workflow
        const result = await runSimulation(spec, ctx);

        // Format output
        const output = formatOutput(result, args.format);
        console.log(output);
      } catch (error) {
        const message = handleError(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
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
      try {
        const args = parseArguments(listRunsSchema, {
          ...options,
          limit: options.limit ? parseInt(options.limit, 10) : 100,
        });

        const { SimulationRunsRepository } = await import('@quantbot/storage');
        const repo = new SimulationRunsRepository();

        // Query runs
        const runs = await repo.query({
          limit: args.limit,
        });

        const output = formatOutput(runs, args.format);
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
const simulationModule: PackageCommandModule = {
  packageName: 'simulation',
  description: 'Trading strategy simulation operations',
  commands: [
    {
      name: 'run',
      description: 'Run simulation on calls',
      schema: runSchema,
      handler: async (args: unknown) => {
        // Handler for programmatic access - would need full context setup
        // For now, return a message indicating workflow usage
        return { message: 'Use CLI command for full workflow execution' };
      },
      examples: [
        'quantbot simulation run --strategy PT2_SL25 --caller Brook --from 2024-01-01 --to 2024-02-01',
      ],
    },
    {
      name: 'list-runs',
      description: 'List simulation runs',
      schema: listRunsSchema,
      handler: async (args: unknown) => {
        const typedArgs = args as z.infer<typeof listRunsSchema>;
        const { SimulationRunsRepository } = await import('@quantbot/storage');
        const repo = new SimulationRunsRepository();
        return await repo.query({ limit: args.limit });
      },
      examples: ['quantbot simulation list-runs --limit 50'],
    },
  ],
};

// Register the module
commandRegistry.registerPackage(simulationModule);
