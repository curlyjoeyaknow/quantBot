import { DateTime } from 'luxon';
import { v4 as uuidv4 } from 'uuid';
import { logger as utilsLogger, ValidationError } from '@quantbot/utils';
import { StrategiesRepository, StorageEngine } from '@quantbot/storage';
// PostgreSQL repositories removed - use DuckDB services/workflows instead
import {
  type StopLossConfig,
  type EntryConfig,
  type ReEntryConfig,
  type CostConfig,
  type SignalGroup,
} from '@quantbot/backtest';
import { DuckDBStorageService } from '@quantbot/backtest';
import { PythonEngine, getDuckDBPath } from '@quantbot/utils';
import type { ClockPort } from '@quantbot/core';
import type {
  WorkflowContext,
  StrategyRecord,
  CallRecord,
  SimulationEngineResult,
  SimulationCallResult,
} from '../types.js';
import { StorageCausalCandleAccessor } from './causal-candle-accessor.js';
import { createLogHubLoggerAdapter } from './logHubLoggerAdapter.js';

// LogHub type definition (to avoid dependency on @quantbot/lab)
type LogHub = {
  emit: (event: {
    level: 'debug' | 'info' | 'warn' | 'error';
    scope: string;
    msg: string;
    ctx?: Record<string, unknown>;
    requestId?: string;
    runId?: string;
    ts?: string;
  }) => void;
};

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
   * Optional LogHub for structured event logging (replaces verbose console logs)
   * When provided, logger will emit filtered events to LogHub instead of console
   */
  logHub?: {
    hub: LogHub;
    scope: string; // e.g. 'simulation', 'ingestion', 'workflow'
    runId?: string;
    requestId?: string;
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
  const { getDuckDBPath } = await import('@quantbot/utils');
  const duckdbPath = config?.duckdbPath || getDuckDBPath('data/tele.duckdb');
  const ports = await createProductionPorts(duckdbPath);

  return {
    ...baseContext,
    ports,
  };
}

export function createProductionContext(config?: ProductionContextConfig): WorkflowContext {
  // DuckDB repositories require dbPath - get from config.yaml, environment, or use default
  // NOTE: Direct instantiation is acceptable here - this is a context factory (composition root)
  const dbPath = getDuckDBPath('data/tele.duckdb');
  const strategiesRepo = new StrategiesRepository(dbPath); // DuckDB version
  // CallersRepository not used in this context - workflows use services instead
  // PostgreSQL repositories removed - use DuckDB services/workflows for calls/tokens/simulation runs

  // Create storage engine (NO SINGLETON - created fresh per context)
  const storageEngine = config?.storageEngine ?? new StorageEngine();

  // Create services for DuckDB and ClickHouse operations (NO SINGLETONS - created fresh per context)
  const pythonEngine = new PythonEngine();
  const duckdbStorage = new DuckDBStorageService(pythonEngine);
  // ClickHouse no longer used - all data goes to parquet
  // const clickHouse = new ClickHouseService(pythonEngine);

  // Use LogHub logger adapter if LogHub is provided, otherwise use default logger
  const logger = config?.logHub
    ? createLogHubLoggerAdapter(
        config.logHub.hub,
        config.logHub.scope,
        config.logHub.runId,
        config.logHub.requestId
      )
    : (config?.logger ?? {
        info: (...args: unknown[]) =>
          utilsLogger.info(String(args[0] || ''), args[1] as Record<string, unknown> | undefined),
        warn: (...args: unknown[]) =>
          utilsLogger.warn(String(args[0] || ''), args[1] as Record<string, unknown> | undefined),
        error: (...args: unknown[]) =>
          utilsLogger.error(String(args[0] || ''), args[1] as Record<string, unknown> | undefined),
        debug: (...args: unknown[]) =>
          utilsLogger.debug(String(args[0] || ''), args[1] as Record<string, unknown> | undefined),
      });
  const clock = config?.clock ?? { nowISO: () => DateTime.utc().toISO()! };
  const ids = config?.ids ?? { newRunId: () => `run_${uuidv4()}` };

  // Create causal candle accessor (wraps storage engine for Gate 2 compliance)
  // Convert WorkflowContext clock (nowISO) to ClockPort (nowMs) format
  const causalAccessorClock: ClockPort = {
    nowMs: () => new Date(clock.nowISO()).getTime(),
  };
  const causalAccessor = new StorageCausalCandleAccessor(
    storageEngine,
    causalAccessorClock,
    '5m',
    'solana'
  );

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
            const result = await duckdbStorage.queryCalls(dbPath, 10000, true); // Large limit for date filtering, exclude unrecoverable
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
          // Store simulation results directly to parquet (not ClickHouse)
          // DuckDB only holds metadata catalogue
          try {
            const { getArtifactsDir } = await import('@quantbot/core');
            const { join } = await import('path');
            const { promises: fs } = await import('fs');
            const { DuckDBClient } = await import('@quantbot/storage');

            const artifactsDir = getArtifactsDir();
            const runDir = join(artifactsDir, runId);
            await fs.mkdir(runDir, { recursive: true });

            if (rows.length === 0) {
              utilsLogger.debug('[workflows.context] No simulation results to write', { runId });
              return;
            }

            // Convert SimulationCallResult[] to parquet-friendly format
            type ParquetRow = {
              run_id: string;
              call_id: string;
              mint: string;
              created_at_iso: string;
              created_at_ts: number;
              ok: boolean;
              pnl_multiplier: number | null;
              trades: number | null;
              error_code: string | null;
              error_message: string | null;
            };

            const parquetRows: ParquetRow[] = rows.map((result) => {
              const createdAt = DateTime.fromISO(result.createdAtISO, { zone: 'utc' });
              return {
                run_id: runId,
                call_id: result.callId,
                mint: result.mint,
                created_at_iso: result.createdAtISO,
                created_at_ts: Math.floor(createdAt.toSeconds()),
                ok: result.ok,
                pnl_multiplier: result.ok && result.pnlMultiplier !== undefined ? result.pnlMultiplier : null,
                trades: result.ok && result.trades !== undefined ? result.trades : null,
                error_code: result.ok ? null : (result.errorCode || null),
                error_message: result.ok ? null : (result.errorMessage || null),
              };
            });

            // Write to parquet using DuckDB
            const db = new DuckDBClient(':memory:');
            try {
              await db.execute('INSTALL parquet;');
              await db.execute('LOAD parquet;');

              // Infer schema from first row
              const firstRow = parquetRows[0];
              if (!firstRow) {
                utilsLogger.debug('[workflows.context] No rows to write to parquet', { runId });
                return;
              }

              const columns: Array<keyof ParquetRow> = Object.keys(firstRow) as Array<keyof ParquetRow>;
              const columnDefs = columns
                .map((col) => {
                  const value = firstRow[col];
                  if (value === null || value === undefined) {
                    return `${String(col)} TEXT`;
                  } else if (typeof value === 'number') {
                    return Number.isInteger(value) ? `${String(col)} BIGINT` : `${String(col)} DOUBLE`;
                  } else if (typeof value === 'boolean') {
                    return `${String(col)} BOOLEAN`;
                  } else {
                    return `${String(col)} TEXT`;
                  }
                })
                .join(', ');

              await db.execute(`CREATE TABLE temp_simulation_results (${columnDefs})`);

              // Insert data in batches
              const batchSize = 1000;
              for (let i = 0; i < parquetRows.length; i += batchSize) {
                const batch = parquetRows.slice(i, i + batchSize);
                for (const row of batch) {
                  const values = columns.map((col) => {
                    const val = row[col];
                    if (val === null || val === undefined) {
                      return 'NULL';
                    } else if (typeof val === 'string') {
                      return `'${String(val).replace(/'/g, "''")}'`;
                    } else if (typeof val === 'boolean') {
                      return val ? 'TRUE' : 'FALSE';
                    } else {
                      return String(val);
                    }
                  });
                  await db.execute(
                    `INSERT INTO temp_simulation_results (${columns.join(', ')}) VALUES (${values.join(', ')})`
                  );
                }
              }

              // Export to Parquet
              const parquetPath = join(runDir, 'simulation_results.parquet');
              await db.execute(`COPY temp_simulation_results TO '${parquetPath.replace(/'/g, "''")}' (FORMAT PARQUET)`);

              logger.info('[workflows.context] Stored simulation results to parquet', {
                runId,
                count: rows.length,
                parquetPath,
              });
            } finally {
              await db.close();
            }
          } catch (error) {
            logger.error('[workflows.context] Error storing simulation results to parquet', {
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
      /**
       * Causal candle accessor - ensures Gate 2 compliance (no look-ahead).
       *
       * This is the ONLY way to access candles in simulations.
       * Legacy getCandles() method removed - all candle access must go through causalAccessor.
       *
       * The accessor enforces:
       * - Closed-bar semantics (ts_close <= t_decision)
       * - No future candles accessible
       * - Monotonic time progression
       */
      causalAccessor,
    },

    simulation: {
      /**
       * Run a simulation with causal candle access.
       *
       * CRITICAL: This function ONLY accepts a CausalCandleAccessor.
       * It is structurally impossible to pass raw candles into a simulation.
       *
       * The causal accessor enforces:
       * - Closed-bar semantics (only candles with closeTime <= simulationTime are accessible)
       * - No future candles (look-ahead bias is impossible)
       * - Monotonic time progression
       *
       * This is the lock that prevents accidental cheating in simulations.
       */
      async run(q: {
        candleAccessor: import('@quantbot/backtest').CausalCandleAccessor;
        mint: string;
        startTime: number;
        endTime: number;
        strategy: StrategyRecord;
        call: CallRecord;
      }): Promise<SimulationEngineResult & { events?: Array<{
        type: string;
        timestamp: number;
        price: number;
        remainingPosition?: number;
        pnlSoFar?: number;
      }> }> {
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

        // Use causal accessor - this is the ONLY path.
        // Legacy { candles: Candle[] } signature removed - impossible to pass raw candles.
        const { simulateStrategyWithCausalAccessor } = await import('@quantbot/backtest');
        const result = await simulateStrategyWithCausalAccessor(
          q.candleAccessor,
          q.mint,
          q.startTime,
          q.endTime,
          strategyLegs,
          config.stopLoss as StopLossConfig | undefined,
          config.entry as EntryConfig | undefined,
          config.reEntry as ReEntryConfig | undefined,
          config.costs as CostConfig | undefined,
          {
            entrySignal: config.entrySignal as SignalGroup | undefined,
            exitSignal: config.exitSignal as SignalGroup | undefined,
            interval: '5m',
          }
        );

        // Map events to a simpler format for storage
        // LegacySimulationEvent has: type, timestamp, price, remainingPosition?, pnlSoFar?
        const events = result.events.map((e) => ({
          type: e.type || 'unknown',
          timestamp: e.timestamp || 0,
          price: e.price || 0,
          remainingPosition: 'remainingPosition' in e ? e.remainingPosition : undefined,
          pnlSoFar: 'pnlSoFar' in e ? e.pnlSoFar : undefined,
        }));

        return {
          pnlMultiplier: result.finalPnl,
          trades: result.events.filter((e) => {
            // Count entry and exit events (exit events include: final_exit, stop_loss, target_hit, etc.)
            const isEntry = e.type === 'entry' || e.type === 'trailing_entry_triggered' || e.type === 're_entry' || e.type === 'ladder_entry';
            const isExit = e.type === 'final_exit' || e.type === 'stop_loss' || e.type === 'target_hit' || e.type === 'ladder_exit';
            return isEntry || isExit;
          }).length,
          events, // Include events for writing to parquet
        };
      },
    },
  };
}
