import { DateTime } from 'luxon';
import { v4 as uuidv4 } from 'uuid';
import { logger as utilsLogger, ValidationError } from '@quantbot/utils';
import { StrategiesRepository, StorageEngine } from '@quantbot/storage';
// PostgreSQL repositories removed - use DuckDB services/workflows instead
import { simulateStrategy } from '@quantbot/simulation';
import { DuckDBStorageService, ClickHouseService } from '@quantbot/simulation';
import { PythonEngine } from '@quantbot/utils';
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

  /**
   * Optional storage engine override (for testing)
   */
  storageEngine?: StorageEngine;
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

  // Create storage engine (NO SINGLETON - created fresh per context)
  const storageEngine = config?.storageEngine ?? new StorageEngine();

  // Create services for DuckDB and ClickHouse operations (NO SINGLETONS - created fresh per context)
  const pythonEngine = new PythonEngine();
  const duckdbStorage = new DuckDBStorageService(pythonEngine);
  const clickHouse = new ClickHouseService(pythonEngine);

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
          // Query DuckDB user_calls_d table via DuckDBStorageService
          try {
            const result = await duckdbStorage.queryCalls(dbPath, 10000); // Large limit for date filtering
            if (!result.success || !result.calls) {
              logger.warn('[workflows.context] Failed to query calls from DuckDB', {
                error: result.error,
                callerName: q.callerName,
                fromISO: q.fromISO,
                toISO: q.toISO,
              });
              return [];
            }

            // Filter by date range and caller name
            const fromDate = DateTime.fromISO(q.fromISO, { zone: 'utc' });
            const toDate = DateTime.fromISO(q.toISO, { zone: 'utc' });

            const filtered = result.calls
              .filter((call) => {
                const callDate = DateTime.fromISO(call.alert_timestamp, { zone: 'utc' });
                return callDate >= fromDate && callDate <= toDate;
              })
              .map((call, index) => ({
                id: `call_${call.mint}_${call.alert_timestamp}_${index}`,
                caller: q.callerName || 'unknown',
                mint: call.mint,
                createdAt: DateTime.fromISO(call.alert_timestamp, { zone: 'utc' }),
              }));

            return filtered;
          } catch (error) {
            logger.error('[workflows.context] Error querying calls from DuckDB', {
              error: error instanceof Error ? error.message : String(error),
              callerName: q.callerName,
              fromISO: q.fromISO,
              toISO: q.toISO,
            });
            return [];
          }
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
          // Store simulation run metadata in DuckDB
          // Note: storeRun() requires mint and alertTimestamp which we don't have here
          // This is metadata about the run itself, not individual call results
          // For now, we'll log it - individual call results are stored via simulationResults.insertMany()
          logger.info('[workflows.context] Simulation run created (metadata only)', {
            runId: run.runId,
            strategyId: run.strategyId,
            fromISO: run.fromISO,
            toISO: run.toISO,
            callerName: run.callerName,
          });
          // TODO: Create a simulation_runs table in DuckDB if needed for run-level metadata
          // For now, run metadata is tracked via the results themselves
        },
      },

      simulationResults: {
        async insertMany(runId: string, rows: SimulationCallResult[]): Promise<void> {
          // Store simulation results in ClickHouse as events
          // Convert SimulationCallResult[] to SimulationEvent[] format
          try {
            const events = rows.flatMap((result) => {
              const events: Array<{
                event_type: string;
                timestamp: number;
                price: number;
                quantity?: number;
                value_usd?: number;
                pnl_usd?: number;
                metadata?: Record<string, unknown>;
              }> = [];

              if (result.ok && result.pnlMultiplier !== undefined) {
                // Create a summary event for successful simulation
                const createdAt = DateTime.fromISO(result.createdAtISO, { zone: 'utc' });
                events.push({
                  event_type: 'simulation_complete',
                  timestamp: Math.floor(createdAt.toSeconds()),
                  price: 0, // Not applicable for summary
                  quantity: result.trades || 0,
                  pnl_usd: result.pnlMultiplier,
                  metadata: {
                    callId: result.callId,
                    mint: result.mint,
                    pnlMultiplier: result.pnlMultiplier,
                    trades: result.trades,
                  },
                });
              } else {
                // Create an error event for failed simulation
                const createdAt = DateTime.fromISO(result.createdAtISO, { zone: 'utc' });
                events.push({
                  event_type: 'simulation_error',
                  timestamp: Math.floor(createdAt.toSeconds()),
                  price: 0,
                  pnl_usd: 0,
                  metadata: {
                    callId: result.callId,
                    mint: result.mint,
                    errorCode: result.errorCode,
                    errorMessage: result.errorMessage,
                  },
                });
              }

              return events;
            });

            const result = await clickHouse.storeEvents(runId, events);
            if (!result.success) {
              logger.error('[workflows.context] Failed to store simulation results in ClickHouse', {
                runId,
                count: rows.length,
                error: result.error,
              });
            } else {
              logger.info('[workflows.context] Stored simulation results in ClickHouse', {
                runId,
                count: rows.length,
                eventsStored: events.length,
              });
            }
          } catch (error) {
            logger.error('[workflows.context] Error storing simulation results', {
              error: error instanceof Error ? error.message : String(error),
              runId,
              count: rows.length,
            });
            // Don't throw - workflow should continue even if storage fails
          }
        },
      },
    },

    ohlcv: {
      async getCandles(q: { mint: string; fromISO: string; toISO: string }): Promise<Candle[]> {
        const startTime = DateTime.fromISO(q.fromISO, { zone: 'utc' });
        const endTime = DateTime.fromISO(q.toISO, { zone: 'utc' });

        // Use storage engine to query candles (offline-only)
        // Storage engine created fresh per context (no singleton)
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
