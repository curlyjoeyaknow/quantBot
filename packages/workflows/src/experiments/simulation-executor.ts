/**
 * Simulation Executor
 *
 * Integration point with @quantbot/simulation package.
 * Loads data from DuckDB projection, runs simulation, and writes results to temp Parquet files.
 *
 * @packageDocumentation
 */

import { openDuckDb, type DuckDbConnection } from '@quantbot/infra/storage';
import { mkdtempSync, rmSync, accessSync, constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  simulateStrategy,
  type Candle,
  type StrategyLeg,
  type StopLossConfig,
  type EntryConfig,
  type ReEntryConfig,
  type CostConfig,
} from '@quantbot/simulation';
import { z } from 'zod';
import { logger } from '@quantbot/infra/utils';
import { DuckDBClient } from '@quantbot/infra/storage';
import type {
  SimulationInput,
  SimulationResults,
  Trade,
  Metrics,
  EquityPoint,
  Diagnostic,
} from './types.js';

/**
 * Zod schema for SimulationResult validation
 */
const SimulationResultSchema = z.object({
  finalPnl: z.number(),
  events: z.array(
    z.object({
      type: z.string(),
      timestamp: z.number(),
      price: z.number(),
      description: z.string(),
      remainingPosition: z.number(),
      pnlSoFar: z.number(),
    })
  ),
  entryPrice: z.number(),
  finalPrice: z.number(),
  totalCandles: z.number(),
  entryOptimization: z.object({
    lowestPrice: z.number(),
    lowestPriceTimestamp: z.number(),
    lowestPricePercent: z.number(),
    lowestPriceTimeFromEntry: z.number(),
    trailingEntryUsed: z.boolean(),
    actualEntryPrice: z.number(),
    entryDelay: z.number(),
  }),
});

/**
 * Execute simulation
 *
 * @param input - Simulation input
 * @returns Simulation results with file paths
 */
export async function executeSimulation(input: SimulationInput): Promise<SimulationResults> {
  // Validate input
  if (!input.duckdbPath || !input.config.dateRange.from || !input.config.dateRange.to) {
    throw new Error('Invalid simulation input: missing required fields');
  }

  const fromDate = new Date(input.config.dateRange.from);
  const toDate = new Date(input.config.dateRange.to);

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    throw new Error('Invalid date range: dates must be valid ISO strings');
  }

  if (fromDate >= toDate) {
    throw new Error('Invalid date range: from date must be before to date');
  }

  // 1. Load data from DuckDB projection
  const { candles, alerts } = await loadDataFromProjection(input.duckdbPath, input.config);

  // 2. Extract strategy configurations
  const stopLossConfig = extractStopLossConfig(input.config.strategy);
  const entryConfig = extractEntryConfig(input.config.strategy);
  const reEntryConfig = extractReEntryConfig(input.config.strategy);
  const costConfig = extractCostConfig(input.config.strategy);

  // 3. Build strategy legs from config
  const strategyLegs = buildStrategyLegs(input.config);

  // 4. Validate DuckDB path exists and is readable
  try {
    accessSync(input.duckdbPath, constants.R_OK);
  } catch (error) {
    throw new Error(`DuckDB path is not accessible: ${input.duckdbPath} - ${error instanceof Error ? error.message : String(error)}`);
  }

  // 5. Create temp directory with permission checks
  const tempDirBase = tmpdir();
  try {
    accessSync(tempDirBase, constants.W_OK);
  } catch (error) {
    throw new Error(`Temp directory is not writable: ${tempDirBase} - ${error instanceof Error ? error.message : String(error)}`);
  }

  // Generate deterministic temp directory name from seed
  const tempDirSuffix = input.seed.toString(36).substring(0, 8);
  const tempDir = mkdtempSync(join(tempDirBase, `sim-results-${tempDirSuffix}-`));
  
  // Validate temp directory was created and is writable
  try {
    accessSync(tempDir, constants.W_OK);
  } catch (error) {
    throw new Error(`Failed to create writable temp directory: ${tempDir} - ${error instanceof Error ? error.message : String(error)}`);
  }

  // 6. Run simulation for each alert (with parallel processing for large batches)
  const allTrades: Trade[] = [];
  const diagnostics: Diagnostic[] = [];
  let totalGrossPnl = 0;
  let totalNetPnl = 0;
  let totalCosts = 0;

  // Parallel processing configuration
  const MAX_CONCURRENT_ALERTS = 10; // Process up to 10 alerts concurrently
  const alertsToProcess = alerts.length;

  try {
    // Process alerts in batches for parallel execution
    for (let i = 0; i < alerts.length; i += MAX_CONCURRENT_ALERTS) {
      const batch = alerts.slice(i, i + MAX_CONCURRENT_ALERTS);
      
      // Process batch in parallel
      const batchResults = await Promise.allSettled(
        batch.map(async (alert, batchIndex) => {
          try {
            // Filter candles for this alert's time range
            const alertCandles = filterCandlesForAlert(candles, alert, input.config);

            if (alertCandles.length === 0) {
              return {
                type: 'warning' as const,
                alert,
                trades: [] as Trade[],
                diagnostic: {
                  level: 'warning' as const,
                  message: `No candles found for alert ${alert.id}`,
                  timestamp: alert.timestamp,
                  callId: alert.id,
                },
              };
            }

            // Generate deterministic seed per alert (base seed + alert index)
            const alertSeed = input.seed + (i + batchIndex);

            // Run simulation with extracted configs
            const result = await simulateStrategy(
              alertCandles,
              strategyLegs,
              stopLossConfig,
              entryConfig,
              reEntryConfig,
              costConfig,
              {
                seed: alertSeed,
              }
            );

            // Validate simulation result
            const validatedResult = SimulationResultSchema.parse(result);

            // Convert simulation result to trade records
            const trades = convertResultToTrades(validatedResult, alert, costConfig);

            return {
              type: 'success' as const,
              alert,
              trades,
            };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
              type: 'error' as const,
              alert,
              trades: [] as Trade[],
              diagnostic: {
                level: 'error' as const,
                message: `Simulation failed for alert ${alert.id}: ${errorMessage}`,
                timestamp: alert.timestamp, // Use alert timestamp, not Date.now()
                callId: alert.id,
                context: {
                  error: errorMessage,
                  stack: error instanceof Error ? error.stack : undefined,
                },
              },
            };
          }
        })
      );

      // Process batch results
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          const { trades, diagnostic } = result.value;
          allTrades.push(...trades);
          
          if (diagnostic) {
            diagnostics.push(diagnostic);
          }

          // Accumulate metrics from trades
          totalGrossPnl += trades.reduce((sum, t) => sum + t.grossPnl, 0);
          totalNetPnl += trades.reduce((sum, t) => sum + t.netPnl, 0);
          totalCosts += trades.reduce((sum, t) => sum + t.entryCosts + t.exitCosts + t.borrowCosts, 0);
        } else {
          // Promise.allSettled failure (shouldn't happen, but handle gracefully)
          // Use first alert timestamp as fallback (or 0 if no alerts)
          const fallbackTimestamp = batch.length > 0 && batch[0] ? batch[0].timestamp : 0;
          diagnostics.push({
            level: 'error',
            message: `Batch processing failed: ${result.reason}`,
            timestamp: fallbackTimestamp,
          });
        }
      }

      // Log progress for large experiments
      if (alertsToProcess > 100 && (i + MAX_CONCURRENT_ALERTS) % 100 === 0) {
        logger.debug('Processing alerts batch', {
          processed: Math.min(i + MAX_CONCURRENT_ALERTS, alertsToProcess),
          total: alertsToProcess,
          progress: `${Math.round(((i + MAX_CONCURRENT_ALERTS) / alertsToProcess) * 100)}%`,
        });
      }
    }

    // 7. Calculate aggregate metrics
    const metrics = calculateMetrics(allTrades, totalGrossPnl, totalNetPnl, totalCosts);

    // 8. Build equity curve
    const equityCurve = buildEquityCurve(allTrades);

    // 9. Write results to temp Parquet files
    const results = await writeResultsToParquet(
      tempDir,
      allTrades,
      metrics,
      equityCurve,
      diagnostics
    );

    // Validate result paths are within temp directory (prevent path traversal)
    const tempDirResolved = resolve(tempDir);
    const resultPaths = [results.tradesPath, results.metricsPath, results.curvesPath];
    if (results.diagnosticsPath) {
      resultPaths.push(results.diagnosticsPath);
    }

    for (const resultPath of resultPaths) {
      const resolvedPath = resolve(resultPath);
      if (!resolvedPath.startsWith(tempDirResolved)) {
        throw new Error(`Result path outside temp directory: ${resultPath}`);
      }
    }

    return {
      ...results,
      inputArtifactIds: [], // Will be populated by caller
    };
  } catch (error) {
    // Cleanup temp directory on error (always attempt cleanup)
    try {
      rmSync(tempDir, { recursive: true, force: true });
      logger.debug('Cleaned up temp directory after error', { tempDir });
    } catch (cleanupError) {
      logger.warn('Failed to cleanup temp directory', {
        tempDir,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        originalError: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  } finally {
    // Ensure temp directory is cleaned up even if no error occurred
    // Note: We keep temp files until artifact publishing succeeds, so cleanup happens in handler
  }
}

/**
 * Load data from DuckDB projection
 */
async function loadDataFromProjection(
  duckdbPath: string,
  config: SimulationInput['config']
): Promise<{ candles: Candle[]; alerts: Alert[] }> {
  const conn = await openDuckDb(duckdbPath);
  
  try {
    // Test connection works
    try {
      await conn.all<{ test: number }>('SELECT 1 as test');
    } catch (error) {
      throw new Error(`DuckDB connection test failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // First verify tables exist - use simpler query
    let tables: { name: string }[];
    try {
      tables = await conn.all<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('ohlcv', 'alerts')`
      );
    } catch {
      // Fallback to information_schema if sqlite_master doesn't work
      try {
        tables = await conn.all<{ name: string }>(
          `SELECT table_name as name FROM information_schema.tables WHERE table_schema = 'main' AND table_name IN ('ohlcv', 'alerts')`
        );
      } catch {
        // If both fail, try to query tables directly (will fail if they don't exist)
        tables = [];
      }
    }
    
    if (tables.length < 2) {
      logger.warn('Tables check inconclusive, proceeding with direct queries', { tablesFound: tables.length });
    }
    
    // Load all data and filter in JavaScript (simpler, avoids complex SQL casting)
    const fromMs = new Date(config.dateRange.from).getTime();
    const toMs = new Date(config.dateRange.to).getTime();
    
    // Load all candles - select ts column as-is, convert to milliseconds in JavaScript
    // Note: ohlcv_slice artifacts use 'ts' not 'timestamp'
    let candleRows: Record<string, unknown>[];
    try {
      candleRows = await conn.all<Record<string, unknown>>(
        `SELECT ts, open, high, low, close, volume FROM ohlcv ORDER BY ts ASC`
      );
    } catch (error) {
      throw new Error(`Failed to load candles from ohlcv table: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Load all alerts - select alert_ts_utc as-is, convert to milliseconds in JavaScript
    // Note: alerts_v1 artifacts use 'alert_ts_utc' not 'timestamp', 'alert_id' not 'id'
    let alertRows: Record<string, unknown>[];
    try {
      alertRows = await conn.all<Record<string, unknown>>(
        `SELECT alert_id, mint, alert_ts_utc FROM alerts ORDER BY alert_ts_utc ASC`
      );
    } catch (error) {
      throw new Error(`Failed to load alerts from alerts table: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // Convert timestamps to milliseconds and filter by date range
    const convertTimestamp = (ts: unknown): number => {
      if (typeof ts === 'number') return ts;
      if (typeof ts === 'bigint') return Number(ts);
      if (ts instanceof Date) return ts.getTime();
      if (typeof ts === 'string') {
        // Try parsing ISO string or milliseconds string
        const parsed = new Date(ts);
        if (!isNaN(parsed.getTime())) return parsed.getTime();
        const num = parseInt(ts, 10);
        if (!isNaN(num)) return num;
      }
      return 0;
    };
    
    const filteredCandles = candleRows
      .map((row) => {
        const timestamp = convertTimestamp(row.ts);
        return {
          timestamp,
          open: row.open as number,
          high: row.high as number,
          low: row.low as number,
          close: row.close as number,
          volume: row.volume as number,
        };
      })
      .filter((c) => c.timestamp >= fromMs && c.timestamp <= toMs);
    
    const filteredAlerts = alertRows
      .map((row) => ({
        id: String(row.alert_id),
        mint: String(row.mint),
        timestamp: convertTimestamp(row.alert_ts_utc),
      }))
      .filter((a) => a.timestamp >= fromMs && a.timestamp <= toMs);

    const candles: Candle[] = filteredCandles;

    // Map alerts - derive price from candles at alert time
    const alerts: Alert[] = filteredAlerts.map((row) => {
      const alertTimestamp = row.timestamp;
      // Find first candle at or after alert timestamp, or use closest candle
      const alertCandle = candles.find((c) => c.timestamp >= alertTimestamp) || 
                          candles[candles.length - 1] ||
                          null;
      const price = alertCandle ? alertCandle.close : 0; // Use close price as default
      
      return {
        id: row.id,
        mint: row.mint,
        timestamp: alertTimestamp,
        price,
      };
    });

    return { candles, alerts };
  } finally {
    // Connection cleanup handled by openDuckDb lifecycle
  }
}

/**
 * Filter candles for alert time range
 */
function filterCandlesForAlert(
  candles: Candle[],
  alert: Alert,
  config: SimulationInput['config']
): Candle[] {
  // Get pre/post window from config (default to 4 hours pre, 24 hours post)
  const preWindowMs = ((config.params.preWindowMinutes as number) ?? 240) * 60 * 1000;
  const postWindowMs = ((config.params.postWindowMinutes as number) ?? 1440) * 60 * 1000;

  const startTime = alert.timestamp - preWindowMs;
  const endTime = alert.timestamp + postWindowMs;

  return candles.filter((c) => c.timestamp >= startTime && c.timestamp <= endTime);
}

/**
 * Extract stop loss config from strategy config
 */
function extractStopLossConfig(strategy: SimulationInput['config']['strategy']): StopLossConfig | undefined {
  if (!strategy.stopLoss) {
    return undefined;
  }

  const stopLoss = strategy.stopLoss;
  if (stopLoss.type === 'fixed' && stopLoss.percent !== undefined) {
    return {
      initial: stopLoss.percent / 100, // Convert percentage to decimal
      trailing: 'none',
    };
  } else if (stopLoss.type === 'trailing' && stopLoss.percent !== undefined) {
    return {
      initial: stopLoss.percent / 100,
      trailing: stopLoss.trailingActivationMultiple ?? 0.5,
    };
  } else if (stopLoss.type === 'time' && stopLoss.timeCandles !== undefined) {
    // Time-based stop loss - convert to initial stop loss
    // This is a simplification; full time-based stop loss requires different handling
    return {
      initial: -0.5, // Default fallback
      trailing: 'none',
    };
  }

  return undefined;
}

/**
 * Extract entry config from strategy config
 */
function extractEntryConfig(strategy: SimulationInput['config']['strategy']): EntryConfig | undefined {
  if (!strategy.entry) {
    return undefined;
  }

  const entry = strategy.entry;
  return {
    initialEntry: entry.delayCandles !== undefined ? 'none' : 'none', // Delay handled separately
    trailingEntry: 'none',
    maxWaitTime: entry.delayCandles ?? 60,
  };
}

/**
 * Extract re-entry config from strategy config
 */
function extractReEntryConfig(_strategy: SimulationInput['config']['strategy']): ReEntryConfig | undefined {
  // Re-entry config not in current strategy interface, return undefined
  return undefined;
}

/**
 * Extract cost config from strategy config
 */
function extractCostConfig(strategy: SimulationInput['config']['strategy']): CostConfig | undefined {
  if (!strategy.costs) {
    return undefined;
  }

  const costs = strategy.costs;
  return {
    entrySlippageBps: (costs.slippage ?? 0) * 100, // Convert percentage to basis points
    exitSlippageBps: (costs.slippage ?? 0) * 100,
    takerFeeBps: ((costs.entryFee ?? 0) + (costs.exitFee ?? 0)) * 100,
    borrowAprBps: (costs.borrowRate ?? 0) * 100 * 365, // Convert annual rate to basis points
  };
}

/**
 * Build strategy legs from config
 */
function buildStrategyLegs(config: SimulationInput['config']): StrategyLeg[] {
  const exitConfig = config.strategy.exit;
  if (!exitConfig?.targets || exitConfig.targets.length === 0) {
    throw new Error('Exit targets are required');
  }

  return exitConfig.targets.map((target) => ({
    target: target.target,
    percent: target.percent,
  }));
}

/**
 * Convert simulation result to trade records
 */
function convertResultToTrades(
  result: z.infer<typeof SimulationResultSchema>,
  alert: Alert,
  costConfig?: CostConfig
): Trade[] {
  const trades: Trade[] = [];

  // Extract entry/exit events from simulation result
  const events = result.events;
  const entryEvents = events.filter((e) => e.type === 'entry' || e.type === 're_entry' || e.type === 'ladder_entry');
  const exitEvents = events.filter(
    (e) => e.type === 'target_hit' || e.type === 'stop_loss' || e.type === 'final_exit'
  );

  // Calculate peak multiple and max drawdown from events
  let peakPrice = result.entryPrice;
  let maxDrawdown = 0;

  for (const event of events) {
    // Track peak price
    if (event.price > peakPrice) {
      peakPrice = event.price;
    }

    // Calculate drawdown from peak
    if (peakPrice > 0) {
      const drawdown = (peakPrice - event.price) / peakPrice;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
  }

  const peakMultiple = result.entryPrice > 0 ? peakPrice / result.entryPrice : 1;

  // Match entries with exits
  let entryIndex = 0;
  for (const exitEvent of exitEvents) {
    // Find corresponding entry event
    const entryEvent = entryEvents[entryIndex];
    if (!entryEvent) {
      continue;
    }

    // Determine exit reason from event type
    let exitReason: 'target' | 'stop_loss' | 'timeout' | 'signal' | 'final' = 'final';
    if (exitEvent.type === 'target_hit') {
      exitReason = 'target';
    } else if (exitEvent.type === 'stop_loss') {
      exitReason = 'stop_loss';
    } else if (exitEvent.type === 'final_exit') {
      exitReason = 'final';
    }

    // Calculate costs
    const entryCosts = calculateEntryCosts(entryEvent.price, costConfig);
    const exitCosts = calculateExitCosts(exitEvent.price, costConfig);
    const borrowCosts = calculateBorrowCosts(
      entryEvent.timestamp,
      exitEvent.timestamp,
      entryEvent.price,
      costConfig
    );

    // Calculate PnL
    const grossPnl = exitEvent.price - entryEvent.price;
    const netPnl = grossPnl - entryCosts - exitCosts - borrowCosts;

    trades.push({
      tradeId: `${alert.id}-${entryIndex}`,
      callId: alert.id,
      mint: alert.mint,
      entryTime: entryEvent.timestamp,
      entryPrice: entryEvent.price,
      exitTime: exitEvent.timestamp,
      exitPrice: exitEvent.price,
      exitReason,
      size: entryEvent.remainingPosition,
      grossPnl,
      netPnl,
      entryCosts,
      exitCosts,
      borrowCosts,
      peakMultiple,
      maxDrawdown,
      duration: exitEvent.timestamp - entryEvent.timestamp,
    });

    entryIndex++;
  }

  // If no exits but we have a final result, create a trade from the result
  if (trades.length === 0 && result.finalPrice > 0 && result.entryPrice > 0) {
    const entryCosts = calculateEntryCosts(result.entryPrice, costConfig);
    const exitCosts = calculateExitCosts(result.finalPrice, costConfig);
    const borrowCosts = calculateBorrowCosts(
      result.entryOptimization.actualEntryPrice > 0
        ? result.entryOptimization.lowestPriceTimestamp
        : 0,
      result.entryOptimization.lowestPriceTimestamp + 24 * 60 * 60 * 1000, // Estimate duration
      result.entryPrice,
      costConfig
    );

    const grossPnl = result.finalPnl * result.entryPrice; // Convert multiplier to USD
    const netPnl = grossPnl - entryCosts - exitCosts - borrowCosts;

    trades.push({
      tradeId: `${alert.id}-0`,
      callId: alert.id,
      mint: alert.mint,
      entryTime: result.entryOptimization.lowestPriceTimestamp,
      entryPrice: result.entryPrice,
      exitTime: result.entryOptimization.lowestPriceTimestamp + result.totalCandles * 5 * 60 * 1000, // Estimate
      exitPrice: result.finalPrice,
      exitReason: 'final',
      size: 1,
      grossPnl,
      netPnl,
      entryCosts,
      exitCosts,
      borrowCosts,
      peakMultiple,
      maxDrawdown,
      duration: result.totalCandles * 5 * 60 * 1000, // Estimate duration
    });
  }

  return trades;
}

/**
 * Calculate entry costs
 */
function calculateEntryCosts(entryPrice: number, costConfig?: CostConfig): number {
  if (!costConfig) {
    return 0;
  }
  const slippage = (entryPrice * costConfig.entrySlippageBps) / 10_000;
  const fee = (entryPrice * costConfig.takerFeeBps) / 10_000;
  return slippage + fee;
}

/**
 * Calculate exit costs
 */
function calculateExitCosts(exitPrice: number, costConfig?: CostConfig): number {
  if (!costConfig) {
    return 0;
  }
  const slippage = (exitPrice * costConfig.exitSlippageBps) / 10_000;
  const fee = (exitPrice * costConfig.takerFeeBps) / 10_000;
  return slippage + fee;
}

/**
 * Calculate borrow costs
 */
function calculateBorrowCosts(
  entryTime: number,
  exitTime: number,
  entryPrice: number,
  costConfig?: CostConfig
): number {
  if (!costConfig || costConfig.borrowAprBps === 0 || entryTime === 0 || exitTime === 0) {
    return 0;
  }

  const durationDays = (exitTime - entryTime) / (1000 * 60 * 60 * 24);
  const annualRate = costConfig.borrowAprBps / 10_000;
  const borrowCost = entryPrice * annualRate * durationDays;
  return borrowCost;
}

/**
 * Calculate aggregate metrics including Sharpe and Sortino ratios
 */
function calculateMetrics(
  trades: Trade[],
  totalGrossPnl: number,
  totalNetPnl: number,
  totalCosts: number
): Metrics {
  if (trades.length === 0) {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      totalPnl: 0,
      totalGrossPnl: 0,
      totalCosts: 0,
      avgDuration: 0,
      maxDrawdown: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
    };
  }

  const winningTrades = trades.filter((t) => t.netPnl > 0);
  const losingTrades = trades.filter((t) => t.netPnl <= 0);

  const avgWin =
    winningTrades.length > 0
      ? winningTrades.reduce((sum, t) => sum + t.netPnl, 0) / winningTrades.length
      : 0;

  const avgLoss =
    losingTrades.length > 0
      ? Math.abs(losingTrades.reduce((sum, t) => sum + t.netPnl, 0) / losingTrades.length)
      : 0;

  const profitFactor = avgLoss > 0 ? avgWin / avgLoss : winningTrades.length > 0 ? Infinity : 0;

  const avgDuration =
    trades.length > 0 ? trades.reduce((sum, t) => sum + t.duration, 0) / trades.length : 0;

  const maxDrawdown = trades.length > 0 ? Math.max(...trades.map((t) => t.maxDrawdown)) : 0;

  // Calculate Sharpe and Sortino ratios from trade returns
  const returns = trades.map((t) => {
    // Convert PnL to return percentage (assuming $1 position size)
    const positionSize = Math.abs(t.entryPrice * t.size) || 1;
    return t.netPnl / positionSize;
  });

  const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;

  // Calculate standard deviation (for Sharpe ratio)
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);

  // Calculate downside deviation (for Sortino ratio)
  const downsideReturns = returns.filter((r) => r < 0);
  const downsideVariance =
    downsideReturns.length > 0
      ? downsideReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / downsideReturns.length
      : 0;
  const downsideDev = Math.sqrt(downsideVariance);

  // Annualize returns (assuming average trade duration)
  const avgTradeDurationDays = avgDuration / (1000 * 60 * 60 * 24);
  const tradesPerYear = avgTradeDurationDays > 0 ? 365 / avgTradeDurationDays : 0;
  const annualizedReturn = meanReturn * tradesPerYear;
  const annualizedStdDev = stdDev * Math.sqrt(tradesPerYear);
  const annualizedDownsideDev = downsideDev * Math.sqrt(tradesPerYear);

  // Risk-free rate (assume 0 for crypto)
  const riskFreeRate = 0;

  // Calculate Sharpe ratio
  const sharpeRatio =
    annualizedStdDev > 0 ? (annualizedReturn - riskFreeRate) / annualizedStdDev : 0;

  // Calculate Sortino ratio
  const sortinoRatio =
    annualizedDownsideDev > 0 ? (annualizedReturn - riskFreeRate) / annualizedDownsideDev : 0;

  return {
    totalTrades: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate: trades.length > 0 ? winningTrades.length / trades.length : 0,
    avgWin,
    avgLoss,
    profitFactor,
    totalPnl: totalNetPnl,
    totalGrossPnl,
    totalCosts,
    avgDuration,
    maxDrawdown,
    sharpeRatio,
    sortinoRatio,
  };
}

/**
 * Build equity curve from trades
 */
function buildEquityCurve(trades: Trade[]): EquityPoint[] {
  const points: EquityPoint[] = [];
  let cumulativePnl = 0;
  let equity = 10000; // Starting equity
  let openPositions = 0;

  // Sort trades by entry time first, then exit time
  const sortedTrades = [...trades].sort((a, b) => {
    if (a.entryTime !== b.entryTime) {
      return a.entryTime - b.entryTime;
    }
    return a.exitTime - b.exitTime;
  });

  // Track entry and exit events separately
  const events: Array<{ timestamp: number; type: 'entry' | 'exit'; trade: Trade }> = [];

  for (const trade of sortedTrades) {
    events.push({ timestamp: trade.entryTime, type: 'entry', trade });
    events.push({ timestamp: trade.exitTime, type: 'exit', trade });
  }

  // Sort all events by timestamp
  events.sort((a, b) => a.timestamp - b.timestamp);

  for (const event of events) {
    if (event.type === 'entry') {
      openPositions++;
    } else {
      cumulativePnl += event.trade.netPnl;
      equity += event.trade.netPnl;
      openPositions = Math.max(0, openPositions - 1);
    }

    points.push({
      timestamp: event.timestamp,
      equity,
      cumulativePnl,
      openPositions,
    });
  }

  return points;
}

/**
 * Write results to Parquet files using DuckDB
 */
async function writeResultsToParquet(
  tempDir: string,
  trades: Trade[],
  metrics: Metrics,
  equityCurve: EquityPoint[],
  diagnostics: Diagnostic[]
): Promise<Omit<SimulationResults, 'inputArtifactIds'>> {
  const tradesPath = join(tempDir, 'trades.parquet');
  const metricsPath = join(tempDir, 'metrics.parquet');
  const curvesPath = join(tempDir, 'curves.parquet');
  const diagnosticsPath = join(tempDir, 'diagnostics.parquet');

  const db = new DuckDBClient(':memory:');

  try {
    await db.execute('INSTALL parquet');
    await db.execute('LOAD parquet');

    // Write trades to Parquet
    if (trades.length > 0) {
      await db.execute(`
        CREATE TABLE trades AS
        SELECT * FROM (
          SELECT
            ?::TEXT as trade_id,
            ?::TEXT as call_id,
            ?::TEXT as mint,
            ?::BIGINT as entry_time,
            ?::DOUBLE as entry_price,
            ?::BIGINT as exit_time,
            ?::DOUBLE as exit_price,
            ?::TEXT as exit_reason,
            ?::DOUBLE as size,
            ?::DOUBLE as gross_pnl,
            ?::DOUBLE as net_pnl,
            ?::DOUBLE as entry_costs,
            ?::DOUBLE as exit_costs,
            ?::DOUBLE as borrow_costs,
            ?::DOUBLE as peak_multiple,
            ?::DOUBLE as max_drawdown,
            ?::BIGINT as duration
          WHERE FALSE
        )
      `);

      const tradeValues = trades.map((t) => {
        const values = [
          `'${t.tradeId.replace(/'/g, "''")}'`,
          `'${t.callId.replace(/'/g, "''")}'`,
          `'${t.mint.replace(/'/g, "''")}'`,
          String(t.entryTime),
          String(t.entryPrice),
          String(t.exitTime),
          String(t.exitPrice),
          `'${t.exitReason.replace(/'/g, "''")}'`,
          String(t.size),
          String(t.grossPnl),
          String(t.netPnl),
          String(t.entryCosts),
          String(t.exitCosts),
          String(t.borrowCosts),
          String(t.peakMultiple),
          String(t.maxDrawdown),
          String(t.duration),
        ];
        return `(${values.join(', ')})`;
      });

      if (tradeValues.length > 0) {
        await db.execute(`INSERT INTO trades VALUES ${tradeValues.join(', ')}`);
      }

      await db.execute(`COPY trades TO '${tradesPath}' (FORMAT PARQUET)`);
    } else {
      // Create empty Parquet file
      await db.execute(`
        CREATE TABLE trades (
          trade_id TEXT,
          call_id TEXT,
          mint TEXT,
          entry_time BIGINT,
          entry_price DOUBLE,
          exit_time BIGINT,
          exit_price DOUBLE,
          exit_reason TEXT,
          size DOUBLE,
          gross_pnl DOUBLE,
          net_pnl DOUBLE,
          entry_costs DOUBLE,
          exit_costs DOUBLE,
          borrow_costs DOUBLE,
          peak_multiple DOUBLE,
          max_drawdown DOUBLE,
          duration BIGINT
        )
      `);
      await db.execute(`COPY trades TO '${tradesPath}' (FORMAT PARQUET)`);
    }

    // Write metrics to Parquet
    await db.execute(`
      CREATE TABLE metrics AS
      SELECT * FROM (
        SELECT
          ?::INTEGER as total_trades,
          ?::INTEGER as winning_trades,
          ?::INTEGER as losing_trades,
          ?::DOUBLE as win_rate,
          ?::DOUBLE as avg_win,
          ?::DOUBLE as avg_loss,
          ?::DOUBLE as profit_factor,
          ?::DOUBLE as total_pnl,
          ?::DOUBLE as total_gross_pnl,
          ?::DOUBLE as total_costs,
          ?::DOUBLE as avg_duration,
          ?::DOUBLE as max_drawdown,
          ?::DOUBLE as sharpe_ratio,
          ?::DOUBLE as sortino_ratio
        WHERE FALSE
      )
    `);

    const metricValues = [
      String(metrics.totalTrades),
      String(metrics.winningTrades),
      String(metrics.losingTrades),
      String(metrics.winRate),
      String(metrics.avgWin),
      String(metrics.avgLoss),
      String(metrics.profitFactor),
      String(metrics.totalPnl),
      String(metrics.totalGrossPnl),
      String(metrics.totalCosts),
      String(metrics.avgDuration),
      String(metrics.maxDrawdown),
      String(metrics.sharpeRatio),
      String(metrics.sortinoRatio),
    ];

    await db.execute(`INSERT INTO metrics VALUES (${metricValues.join(', ')})`);
    await db.execute(`COPY metrics TO '${metricsPath}' (FORMAT PARQUET)`);

    // Write equity curve to Parquet
    if (equityCurve.length > 0) {
      await db.execute(`
        CREATE TABLE curves AS
        SELECT * FROM (
          SELECT
            ?::BIGINT as timestamp,
            ?::DOUBLE as equity,
            ?::DOUBLE as cumulative_pnl,
            ?::INTEGER as open_positions
          WHERE FALSE
        )
      `);

      const curveValues = equityCurve.map((p) => {
        return `(${String(p.timestamp)}, ${String(p.equity)}, ${String(p.cumulativePnl)}, ${String(p.openPositions)})`;
      });

      await db.execute(`INSERT INTO curves VALUES ${curveValues.join(', ')}`);
      await db.execute(`COPY curves TO '${curvesPath}' (FORMAT PARQUET)`);
    } else {
      await db.execute(`
        CREATE TABLE curves (
          timestamp BIGINT,
          equity DOUBLE,
          cumulative_pnl DOUBLE,
          open_positions INTEGER
        )
      `);
      await db.execute(`COPY curves TO '${curvesPath}' (FORMAT PARQUET)`);
    }

    // Write diagnostics to Parquet
    if (diagnostics.length > 0) {
      await db.execute(`
        CREATE TABLE diagnostics AS
        SELECT * FROM (
          SELECT
            ?::TEXT as level,
            ?::TEXT as message,
            ?::BIGINT as timestamp,
            ?::TEXT as call_id,
            ?::TEXT as context
          WHERE FALSE
        )
      `);

      const diagnosticValues = diagnostics.map((d) => {
        const contextStr = d.context ? JSON.stringify(d.context).replace(/'/g, "''") : 'NULL';
        return `('${d.level}', '${d.message.replace(/'/g, "''")}', ${String(d.timestamp)}, ${d.callId ? `'${d.callId.replace(/'/g, "''")}'` : 'NULL'}, ${contextStr !== 'NULL' ? `'${contextStr}'` : 'NULL'})`;
      });

      await db.execute(`INSERT INTO diagnostics VALUES ${diagnosticValues.join(', ')}`);
      await db.execute(`COPY diagnostics TO '${diagnosticsPath}' (FORMAT PARQUET)`);
    } else {
      await db.execute(`
        CREATE TABLE diagnostics (
          level TEXT,
          message TEXT,
          timestamp BIGINT,
          call_id TEXT,
          context TEXT
        )
      `);
      await db.execute(`COPY diagnostics TO '${diagnosticsPath}' (FORMAT PARQUET)`);
    }

    logger.debug('Wrote simulation results to Parquet', {
      tradesPath,
      metricsPath,
      curvesPath,
      diagnosticsPath,
    });

    return {
      tradesPath,
      metricsPath,
      curvesPath,
      diagnosticsPath,
    };
  } finally {
    await db.close();
  }
}

/**
 * Alert record
 */
interface Alert {
  id: string;
  mint: string;
  timestamp: number;
  price: number;
}
