import { DateTime } from 'luxon';
import { v4 as uuidv4 } from 'uuid';
import { logger as utilsLogger, ValidationError } from '@quantbot/utils';
import {
  StrategiesRepository,
  getStorageEngine,
} from '@quantbot/storage';
// PostgreSQL repositories removed - use DuckDB services/workflows instead
import { simulateStrategy } from '@quantbot/simulation';
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
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    debug?: (...args: unknown[]) => void;
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
 * - DuckDB repositories (strategies, callers, token data)
 * - Real OHLCV candle fetching (HybridCandleProvider)
 * - Real simulation engine (simulateStrategy)
 * - Real clock and ID generation
 *
 * Note: Calls, tokens, and simulation runs are accessed via DuckDB services/workflows,
 * not direct repository calls.
 */
export function createProductionContext(config?: ProductionContextConfig): WorkflowContext {
  // DuckDB repositories require dbPath - get from environment or use default
  const dbPath = process.env.DUCKDB_PATH || 'data/quantbot.db';
  const strategiesRepo = new StrategiesRepository(dbPath); // DuckDB version
  // CallersRepository not used in this context - workflows use services instead
  // PostgreSQL repositories removed - use DuckDB services/workflows for calls/tokens/simulation runs

  const logger = config?.logger ?? {
    info: (...args: unknown[]) => utilsLogger.info(String(args[0] || ''), args[1] as any),
    warn: (...args: unknown[]) => utilsLogger.warn(String(args[0] || ''), args[1] as any),
    error: (...args: unknown[]) => utilsLogger.error(String(args[0] || ''), args[1] as any),
    debug: (...args: unknown[]) => utilsLogger.debug(String(args[0] || ''), args[1] as any),
  };
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
          // PostgreSQL CallsRepository removed - use DuckDB services/workflows
          // For now, return empty array - workflows should use runSimulationDuckdb which queries DuckDB directly
          logger.warn('[workflows.context] Calls.list() not available - use DuckDB workflows instead', {
            callerName: q.callerName,
            fromISO: q.fromISO,
            toISO: q.toISO,
          });
          return [];
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
          // PostgreSQL SimulationRunsRepository removed - use DuckDB storage service
          logger.warn('[workflows.context] SimulationRuns.create() not available - use DuckDB storage service instead', {
            runId: run.runId,
            strategyId: run.strategyId,
          });
          // No-op for now - workflows should use DuckDB storage service
        },
      },

      simulationResults: {
        async insertMany(runId: string, rows: SimulationCallResult[]): Promise<void> {
          // PostgreSQL SimulationResultsRepository removed - use DuckDB storage service
          logger.warn('[workflows.context] SimulationResults.insertMany() not available - use DuckDB storage service instead', {
            runId,
            count: rows.length,
          });
          // No-op for now - workflows should use DuckDB storage service
        },
      },
    },

    ohlcv: {
      async getCandles(q: { mint: string; fromISO: string; toISO: string }): Promise<Candle[]> {
        const startTime = DateTime.fromISO(q.fromISO, { zone: 'utc' });
        const endTime = DateTime.fromISO(q.toISO, { zone: 'utc' });

        // Use storage engine to query candles (offline-only)
        const storageEngine = getStorageEngine();
        const candles = await storageEngine.getCandles(q.mint, 'solana', startTime, endTime, {
          interval: '5m',
        });

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
        ) as Array<{ target: number; percent: number }>;

        if (!Array.isArray(strategyLegs) || strategyLegs.length === 0) {
          throw new ValidationError('Invalid strategy config: missing legs array', {
            strategyId: q.strategy.id,
            config: q.strategy.config,
          });
        }

        // Run simulation - cast config types to match simulation engine expectations
        // Config comes from database as unknown, so we cast to expected types
        const result = await simulateStrategy(
          q.candles,
          strategyLegs,
          config.stopLoss as any,
          config.entry as any,
          config.reEntry as any,
          config.costs as any,
          {
            entrySignal: config.entrySignal as any,
            exitSignal: config.exitSignal as any,
          }
        );

        return {
          pnlMultiplier: result.finalPnl,
          trades: result.events.filter((e: { type?: string }) => {
            return e.type === 'entry' || e.type === 'exit';
          }).length,
        };
      },
    },
  };
}
