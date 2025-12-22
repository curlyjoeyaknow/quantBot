import { DateTime } from 'luxon';
import { v4 as uuidv4 } from 'uuid';
import { logger as utilsLogger, ValidationError } from '@quantbot/utils';
import { StrategiesRepository, StorageEngine } from '@quantbot/storage';
// PostgreSQL repositories removed - use DuckDB services/workflows instead
import {
  simulateStrategy,
  type StopLossConfig,
  type EntryConfig,
  type ReEntryConfig,
  type CostConfig,
  type SignalGroup,
} from '@quantbot/simulation';
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

// Re-export WorkflowContext for convenience
export type { WorkflowContext } from '../types.js';

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
/**
 * Create production context with ports
 *
 * This extends the existing WorkflowContext with ports.
 * Ports are added incrementally as adapters are created.
 */
export async function createProductionContextWithPorts(
  config?: ProductionContextConfig & {
    /**
     * Optional DuckDB path override (for testing)
     */
    duckdbPath?: string;
  }
): Promise<WorkflowContext & { ports: import('./ports.js').ProductionPorts }> {
  const baseContext = createProductionContext(config);
  const { createProductionPorts } = await import('./createProductionPorts.js');

  // Get DuckDB path from config, environment, or use default
  const duckdbPath = config?.duckdbPath || process.env.DUCKDB_PATH || 'data/tele.duckdb';
  const ports = await createProductionPorts(duckdbPath);

  return {
    ...baseContext,
    ports,
  };
}

export function createProductionContext(config?: ProductionContextConfig): WorkflowContext {
  // DuckDB repositories require dbPath - get from environment or use default
  const dbPath = process.env.DUCKDB_PATH || 'data/tele.duckdb';
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
    info: (...args: unknown[]) =>
      utilsLogger.info(String(args[0] || ''), args[1] as Record<string, unknown> | undefined),
    warn: (...args: unknown[]) =>
      utilsLogger.warn(String(args[0] || ''), args[1] as Record<string, unknown> | undefined),
    error: (...args: unknown[]) =>
      utilsLogger.error(String(args[0] || ''), args[1] as Record<string, unknown> | undefined),
    debug: (...args: unknown[]) =>
      utilsLogger.debug(String(args[0] || ''), args[1] as Record<string, unknown> | undefined),
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
              .filter((call: Record<string, unknown>) => {
                const alertTimestamp = call.alert_timestamp;
                if (typeof alertTimestamp !== 'string') {
                  return false;
                }
                const callDate = DateTime.fromISO(alertTimestamp, { zone: 'utc' });
                return callDate >= fromDate && callDate <= toDate;
              })
              .map((call: Record<string, unknown>, index: number) => {
                const alertTimestamp = call.alert_timestamp;
                const mint = call.mint;
                if (typeof alertTimestamp !== 'string' || typeof mint !== 'string') {
                  throw new ValidationError('Invalid call data: missing alert_timestamp or mint', {
                    call,
                    index,
                  });
                }
                return {
                  id: `call_${mint}_${alertTimestamp}_${index}`,
                  caller: q.callerName || 'unknown',
                  mint,
                  createdAt: DateTime.fromISO(alertTimestamp, { zone: 'utc' }),
                };
              });

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
          strategyName: string;
          strategyConfig: unknown;
          fromISO: string;
          toISO: string;
          callerName?: string;
          totalCalls?: number;
          successfulCalls?: number;
          failedCalls?: number;
          totalTrades?: number;
          pnlStats?: {
            min?: number;
            max?: number;
            mean?: number;
            median?: number;
          };
        }): Promise<void> {
          // Store simulation run metadata in DuckDB with strategy configuration
          // This stores run-level metadata (not per-call) for performance viewing and reproducibility
          try {
            const config = run.strategyConfig as Record<string, unknown>;

            // Extract strategy config components
            const entryConfig = (config.entry || {}) as Record<string, unknown>;
            const exitConfig = (config.exit || {}) as Record<string, unknown>;
            const reEntryConfig = (config.reEntry || config.reentry) as
              | Record<string, unknown>
              | undefined;
            const costConfig = (config.costs || config.cost) as Record<string, unknown> | undefined;
            const stopLossConfig = (config.stopLoss || config.stop_loss) as
              | Record<string, unknown>
              | undefined;
            const entrySignalConfig = (config.entrySignal || config.entry_signal) as
              | Record<string, unknown>
              | undefined;
            const exitSignalConfig = (config.exitSignal || config.exit_signal) as
              | Record<string, unknown>
              | undefined;

            // Calculate aggregate metrics
            const pnlMean = run.pnlStats?.mean;
            const _pnlMin = run.pnlStats?.min;
            const _pnlMax = run.pnlStats?.max;
            const winRate =
              run.successfulCalls && run.totalCalls
                ? run.successfulCalls / run.totalCalls
                : undefined;

            // Use a synthetic mint/alertTimestamp for run-level records
            // The run_id serves as the unique identifier
            const syntheticMint = `run_${run.runId}`;
            const syntheticAlertTimestamp = run.fromISO; // Use start of date range

            const result = await duckdbStorage.storeRun(
              dbPath,
              run.runId,
              run.strategyId,
              run.strategyName,
              syntheticMint,
              syntheticAlertTimestamp,
              run.fromISO,
              run.toISO,
              1000.0, // initialCapital - default value for run-level records
              {
                entry: entryConfig,
                exit: exitConfig,
                reEntry: reEntryConfig,
                costs: costConfig,
                stopLoss: stopLossConfig,
                entrySignal: entrySignalConfig,
                exitSignal: exitSignalConfig,
              },
              run.callerName,
              undefined, // finalCapital - not available at run level
              pnlMean, // totalReturnPct - use mean PnL
              undefined, // maxDrawdownPct - not calculated at run level
              undefined, // sharpeRatio - not calculated at run level
              winRate,
              run.totalTrades || 0
            );

            if (!result.success) {
              logger.error('[workflows.context] Failed to store simulation run', {
                runId: run.runId,
                error: result.error,
              });
            } else {
              logger.info('[workflows.context] Stored simulation run with strategy config', {
                runId: run.runId,
                strategyId: run.strategyId,
                strategyName: run.strategyName,
                fromISO: run.fromISO,
                toISO: run.toISO,
                callerName: run.callerName,
                totalCalls: run.totalCalls,
                successfulCalls: run.successfulCalls,
                totalTrades: run.totalTrades,
              });
            }
          } catch (error) {
            logger.error('[workflows.context] Error storing simulation run', {
              error: error instanceof Error ? error.message : String(error),
              runId: run.runId,
            });
            // Don't throw - workflow should continue even if storage fails
          }
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
          config.stopLoss as StopLossConfig | undefined,
          config.entry as EntryConfig | undefined,
          config.reEntry as ReEntryConfig | undefined,
          config.costs as CostConfig | undefined,
          {
            entrySignal: config.entrySignal as SignalGroup | undefined,
            exitSignal: config.exitSignal as SignalGroup | undefined,
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
