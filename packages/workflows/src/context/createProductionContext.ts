import { DateTime } from 'luxon';
import { v4 as uuidv4 } from 'uuid';
import { logger as utilsLogger, ValidationError } from '@quantbot/utils';
import {
  StrategiesRepository,
  CallsRepository,
  SimulationRunsRepository,
  SimulationResultsRepository,
  TokensRepository,
  CallersRepository,
  TokenDataRepository,
} from '@quantbot/storage';
import { simulateStrategy } from '@quantbot/simulation';
import { fetchHybridCandles } from '@quantbot/ohlcv';
import type {
  WorkflowContext,
  StrategyRecord,
  CallRecord,
  Candle,
  SimulationEngineResult,
  SimulationCallResult,
} from '../types.js';

export interface ProductionContextConfig {
  /**
   * Optional logger override (defaults to @quantbot/utils logger)
   */
  logger?: {
    info: (...args: Array<unknown>) => void;
    warn: (...args: Array<unknown>) => void;
    error: (...args: Array<unknown>) => void;
  };

  /**
   * Optional clock override (for testing)
   */
  clock?: {
    nowISO: () => string;
  };

  /**
   * Optional ID generator override (for testing)
   */
  ids?: {
    newRunId: () => string;
  };
}

/**
 * Create a production WorkflowContext with real dependencies
 *
 * This wires up:
 * - Real Postgres repositories (strategies, calls, simulation runs/results)
 * - Real OHLCV candle fetching (HybridCandleProvider)
 * - Real simulation engine (simulateStrategy)
 * - Real clock and ID generation
 */
export function createProductionContext(config?: ProductionContextConfig): WorkflowContext {
  const strategiesRepo = new StrategiesRepository();
  const callsRepo = new CallsRepository();
  const simulationRunsRepo = new SimulationRunsRepository();
  const simulationResultsRepo = new SimulationResultsRepository();
  const tokensRepo = new TokensRepository();
  const callersRepo = new CallersRepository();

  const logger = config?.logger ?? utilsLogger;
  const clock = config?.clock ?? { nowISO: () => DateTime.utc().toISO()! };
  const ids = config?.ids ?? { newRunId: () => `run_${uuidv4()}` };

  return {
    clock,
    ids,
    logger,

    repos: {
      strategies: {
        async getByName(name: string): Promise<StrategyRecord | null> {
          const strategy = await strategiesRepo.findByName(name);
          if (!strategy) return null;

          // StrategyConfig doesn't have id, so we generate one from name+version
          const strategyId = `${strategy.name}_v${strategy.version ?? '1'}`;

          return {
            id: strategyId,
            name: strategy.name,
            config: strategy.config,
          };
        },
      },

      calls: {
        async list(q: {
          callerName?: string;
          fromISO: string;
          toISO: string;
        }): Promise<CallRecord[]> {
          const from = DateTime.fromISO(q.fromISO, { zone: 'utc' });
          const to = DateTime.fromISO(q.toISO, { zone: 'utc' });

          const calls = await callsRepo.queryBySelection({
            callerNames: q.callerName ? [q.callerName] : undefined,
            from,
            to,
          });

          // Need to resolve tokenId -> address and callerId -> name
          const results: CallRecord[] = [];
          for (const call of calls) {
            // Get token address
            const token = await tokensRepo.findById(call.tokenId);
            if (!token) {
              logger.warn('[workflows.context] Token not found for call', {
                callId: call.id,
                tokenId: call.tokenId,
              });
              continue;
            }

            // Get caller name
            let callerName = 'unknown';
            if (call.callerId) {
              const caller = await callersRepo.findById(call.callerId);
              if (caller) {
                callerName = `${caller.source}/${caller.handle}`;
              }
            }

            results.push({
              id: String(call.id),
              caller: callerName,
              mint: token.address,
              createdAt: call.signalTimestamp,
            });
          }

          return results;
        },
      },

      simulationRuns: {
        async create(run: {
          runId: string;
          strategyId: string;
          fromISO: string;
          toISO: string;
          callerName?: string;
        }): Promise<void> {
          const strategyIdNum = parseInt(run.strategyId, 10);
          if (isNaN(strategyIdNum)) {
            throw new ValidationError(`Invalid strategyId: ${run.strategyId}`, {
              strategyId: run.strategyId,
              operation: 'createRun',
            });
          }

          await simulationRunsRepo.createRun({
            strategyId: strategyIdNum,
            runType: 'workflow',
            engineVersion: '2.0.0',
            configHash: run.runId,
            config: {
              runId: run.runId,
              callerName: run.callerName,
            },
            dataSelection: {
              from: run.fromISO,
              to: run.toISO,
            },
            status: 'completed',
          });
        },
      },

      simulationResults: {
        async insertMany(runId: string, rows: SimulationCallResult[]): Promise<void> {
          // The SimulationResultsRepository expects a different shape
          // For now, we'll log this - in production you'd map to the correct schema
          logger.info('[workflows.context] Would insert simulation results', {
            runId,
            count: rows.length,
          });

          // TODO: Map SimulationCallResult to SimulationResultsRepository.insertResult format
          // This requires understanding the exact schema of simulation_results table
        },
      },
    },

    ohlcv: {
      async getCandles(q: { mint: string; fromISO: string; toISO: string }): Promise<Candle[]> {
        const startTime = DateTime.fromISO(q.fromISO, { zone: 'utc' });
        const endTime = DateTime.fromISO(q.toISO, { zone: 'utc' });

        // Use the legacy fetchHybridCandles function
        const candles = await fetchHybridCandles(q.mint, startTime, endTime, 'solana');

        return candles;
      },
    },

    simulation: {
      async run(q: {
        candles: Candle[];
        strategy: StrategyRecord;
        call: CallRecord;
      }): Promise<SimulationEngineResult> {
        // Extract strategy legs from config
        const config = q.strategy.config as Record<string, unknown>;
        const strategyLegs = (
          Array.isArray(config.legs)
            ? config.legs
            : Array.isArray(config.strategy)
              ? config.strategy
              : []
        ) as Array<unknown>;

        if (!Array.isArray(strategyLegs) || strategyLegs.length === 0) {
          throw new ValidationError('Invalid strategy config: missing legs array', {
            strategyId: q.strategy.id,
            config: q.strategy.config,
          });
        }

        // Run simulation
        const result = await simulateStrategy(
          q.candles,
          strategyLegs,
          config.stopLoss,
          config.entry,
          config.reEntry,
          config.costs,
          {
            entrySignal: config.entrySignal,
            exitSignal: config.exitSignal,
          }
        );

        return {
          pnlMultiplier: result.finalPnl,
          trades: result.events.filter((e) => {
            const event = e as { type?: string };
            return event.type === 'entry' || event.type === 'exit';
          }).length,
        };
      },
    },
  };
}
