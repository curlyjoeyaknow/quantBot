/**
 * Simulation Executor
 *
 * Integration point with @quantbot/simulation package.
 * Loads data from DuckDB projection, runs simulation, and writes results to temp Parquet files.
 *
 * @packageDocumentation
 */

import { Database } from 'duckdb';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { simulateStrategy, type Candle, type StrategyLeg } from '@quantbot/simulation';
import type {
  SimulationInput,
  SimulationResults,
  Trade,
  Metrics,
  EquityPoint,
  Diagnostic,
} from './types.js';

/**
 * Execute simulation
 *
 * @param input - Simulation input
 * @returns Simulation results with file paths
 */
export async function executeSimulation(input: SimulationInput): Promise<SimulationResults> {
  // 1. Load data from DuckDB projection
  const { candles, alerts } = await loadDataFromProjection(input.duckdbPath, input.config);

  // 2. Run simulation for each alert
  const allTrades: Trade[] = [];
  const diagnostics: Diagnostic[] = [];
  let totalGrossPnl = 0;
  let totalNetPnl = 0;
  let totalCosts = 0;

  for (const alert of alerts) {
    try {
      // Filter candles for this alert's time range
      const alertCandles = filterCandlesForAlert(candles, alert, input.config);

      if (alertCandles.length === 0) {
        diagnostics.push({
          level: 'warning',
          message: `No candles found for alert ${alert.id}`,
          timestamp: alert.timestamp,
          callId: alert.id,
        });
        continue;
      }

      // Build strategy legs from config
      const strategyLegs = buildStrategyLegs(input.config);

      // Run simulation
      const result = await simulateStrategy(
        alertCandles,
        strategyLegs,
        undefined, // stopLoss - will use defaults
        undefined, // entry - will use defaults
        undefined, // reentry config
        undefined, // costs - will use defaults
        {
          seed: input.seed,
        }
      );

      // Convert simulation result to trade records
      const trades = convertResultToTrades(result as unknown as Record<string, unknown>, alert);
      allTrades.push(...trades);

      // Accumulate metrics from trades
      totalGrossPnl += trades.reduce((sum, t) => sum + t.grossPnl, 0);
      totalNetPnl += trades.reduce((sum, t) => sum + t.netPnl, 0);
      totalCosts += trades.reduce((sum, t) => sum + t.entryCosts + t.exitCosts + t.borrowCosts, 0);
    } catch (error) {
      diagnostics.push({
        level: 'error',
        message: `Simulation failed for alert ${alert.id}: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: alert.timestamp,
        callId: alert.id,
      });
    }
  }

  // 3. Calculate aggregate metrics
  const metrics = calculateMetrics(allTrades, totalGrossPnl, totalNetPnl, totalCosts);

  // 4. Build equity curve
  const equityCurve = buildEquityCurve(allTrades);

  // 5. Write results to temp Parquet files
  const tempDir = mkdtempSync(join(tmpdir(), 'sim-results-'));
  const results = await writeResultsToParquet(
    tempDir,
    allTrades,
    metrics,
    equityCurve,
    diagnostics
  );

  return {
    ...results,
    inputArtifactIds: [], // Will be populated by caller
  };
}

/**
 * Load data from DuckDB projection
 */
async function loadDataFromProjection(
  duckdbPath: string,
  config: SimulationInput['config']
): Promise<{ candles: Candle[]; alerts: Alert[] }> {
  return new Promise((resolve, reject) => {
    const db = new Database(duckdbPath);

    // Load candles
    db.all(
      `SELECT timestamp, open, high, low, close, volume
       FROM ohlcv
       WHERE timestamp >= ? AND timestamp <= ?
       ORDER BY timestamp ASC`,
      [
        new Date(config.dateRange.from).getTime(),
        new Date(config.dateRange.to).getTime(),
      ],
      (err, candleRows) => {
        if (err) {
          db.close();
          return reject(err);
        }

        // Load alerts
        db.all(
          `SELECT id, mint, timestamp, price
           FROM alerts
           WHERE timestamp >= ? AND timestamp <= ?
           ORDER BY timestamp ASC`,
          [
            new Date(config.dateRange.from).getTime(),
            new Date(config.dateRange.to).getTime(),
          ],
          (err2, alertRows) => {
            db.close();

            if (err2) {
              return reject(err2);
            }

            const candles = (candleRows as Array<Record<string, unknown>>).map((row) => ({
              timestamp: row.timestamp as number,
              open: row.open as number,
              high: row.high as number,
              low: row.low as number,
              close: row.close as number,
              volume: row.volume as number,
            }));

            const alerts = (alertRows as Array<Record<string, unknown>>).map((row) => ({
              id: row.id as string,
              mint: row.mint as string,
              timestamp: row.timestamp as number,
              price: row.price as number,
            }));

            resolve({ candles, alerts });
          }
        );
      }
    );
  });
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
  const preWindowMs = (config.params.preWindowMinutes as number ?? 240) * 60 * 1000;
  const postWindowMs = (config.params.postWindowMinutes as number ?? 1440) * 60 * 1000;

  const startTime = alert.timestamp - preWindowMs;
  const endTime = alert.timestamp + postWindowMs;

  return candles.filter((c) => c.timestamp >= startTime && c.timestamp <= endTime);
}

/**
 * Build strategy legs from config
 */
function buildStrategyLegs(config: SimulationInput['config']): StrategyLeg[] {
  const exitConfig = config.strategy.exit;
  if (!exitConfig?.targets) {
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
function convertResultToTrades(result: Record<string, unknown>, alert: Alert): Trade[] {
  const trades: Trade[] = [];

  // Extract entry/exit events from simulation result
  const events = (result.events as Array<Record<string, unknown>>) ?? [];
  const entryEvents = events.filter((e) => e.event_type === 'entry');
  const exitEvents = events.filter((e) => e.event_type === 'exit');

  // Match entries with exits
  for (let i = 0; i < entryEvents.length; i++) {
    const entry = entryEvents[i];
    const exit = exitEvents[i]; // Assume 1:1 mapping for now

    if (!exit || !entry) continue;

    const exitReason = (exit.reason as string) ?? 'unknown';
    const validExitReason: 'target' | 'stop_loss' | 'timeout' | 'signal' | 'final' =
      exitReason === 'target' || exitReason === 'stop_loss' || exitReason === 'timeout' || exitReason === 'signal' || exitReason === 'final'
        ? exitReason
        : 'final';

    trades.push({
      tradeId: `${alert.id}-${i}`,
      callId: alert.id,
      mint: alert.mint,
      entryTime: (entry.timestamp as number) ?? 0,
      entryPrice: (entry.price as number) ?? 0,
      exitTime: (exit.timestamp as number) ?? 0,
      exitPrice: (exit.price as number) ?? 0,
      exitReason: validExitReason,
      size: (entry.quantity as number) ?? 0,
      grossPnl: (exit.pnl_usd as number) ?? 0,
      netPnl: (exit.cumulative_pnl_usd as number) ?? 0,
      entryCosts: (entry.fee_usd as number) ?? 0,
      exitCosts: (exit.fee_usd as number) ?? 0,
      borrowCosts: 0, // TODO: Extract from result
      peakMultiple: (result.peakMultiple as number) ?? 1,
      maxDrawdown: (result.maxDrawdown as number) ?? 0,
      duration: ((exit.timestamp as number) ?? 0) - ((entry.timestamp as number) ?? 0),
    });
  }

  return trades;
}

/**
 * Calculate aggregate metrics
 */
function calculateMetrics(
  trades: Trade[],
  totalGrossPnl: number,
  totalNetPnl: number,
  totalCosts: number
): Metrics {
  const winningTrades = trades.filter((t) => t.netPnl > 0);
  const losingTrades = trades.filter((t) => t.netPnl <= 0);

  const avgWin = winningTrades.length > 0
    ? winningTrades.reduce((sum, t) => sum + t.netPnl, 0) / winningTrades.length
    : 0;

  const avgLoss = losingTrades.length > 0
    ? Math.abs(losingTrades.reduce((sum, t) => sum + t.netPnl, 0) / losingTrades.length)
    : 0;

  const profitFactor = avgLoss > 0 ? avgWin / avgLoss : 0;

  const avgDuration = trades.length > 0
    ? trades.reduce((sum, t) => sum + t.duration, 0) / trades.length
    : 0;

  const maxDrawdown = trades.length > 0
    ? Math.max(...trades.map((t) => t.maxDrawdown))
    : 0;

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
    sharpeRatio: 0, // TODO: Calculate
    sortinoRatio: 0, // TODO: Calculate
  };
}

/**
 * Build equity curve from trades
 */
function buildEquityCurve(trades: Trade[]): EquityPoint[] {
  const points: EquityPoint[] = [];
  let cumulativePnl = 0;
  let equity = 10000; // Starting equity

  // Sort trades by exit time
  const sortedTrades = [...trades].sort((a, b) => a.exitTime - b.exitTime);

  for (const trade of sortedTrades) {
    cumulativePnl += trade.netPnl;
    equity += trade.netPnl;

    points.push({
      timestamp: trade.exitTime,
      equity,
      cumulativePnl,
      openPositions: 0, // TODO: Track open positions
    });
  }

  return points;
}

/**
 * Write results to Parquet files
 */
async function writeResultsToParquet(
  tempDir: string,
  trades: Trade[],
  metrics: Metrics,
  equityCurve: EquityPoint[],
  diagnostics: Diagnostic[]
): Promise<Omit<SimulationResults, 'inputArtifactIds'>> {
  // For now, write as JSON (TODO: Use Parquet library)
  const tradesPath = join(tempDir, 'trades.json');
  const metricsPath = join(tempDir, 'metrics.json');
  const curvesPath = join(tempDir, 'curves.json');
  const diagnosticsPath = join(tempDir, 'diagnostics.json');

  writeFileSync(tradesPath, JSON.stringify(trades, null, 2));
  writeFileSync(metricsPath, JSON.stringify(metrics, null, 2));
  writeFileSync(curvesPath, JSON.stringify(equityCurve, null, 2));
  writeFileSync(diagnosticsPath, JSON.stringify(diagnostics, null, 2));

  return {
    tradesPath,
    metricsPath,
    curvesPath,
    diagnosticsPath,
  };
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

