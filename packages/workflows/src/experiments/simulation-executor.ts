/**
 * Simulation Executor
 *
 * Integration point with Python simulation service.
 * Extracts alerts from DuckDB projection, runs Python simulation, and writes results to temp Parquet files.
 *
 * @packageDocumentation
 */

import { openDuckDb } from '@quantbot/infra/storage';
import { mkdtempSync, rmSync, accessSync, constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import type { SimulationService, SimulationConfig, SimulationOutput } from '@quantbot/simulation';
import type {
  SimulationInput,
  SimulationResults,
  Trade,
  Metrics,
  EquityPoint,
  Diagnostic,
} from './types.js';

/**
 * Execute simulation using Python SimulationService
 *
 * @param input - Simulation input
 * @param simulationService - Python simulation service
 * @returns Simulation results with file paths
 */
export async function executeSimulation(
  input: SimulationInput,
  simulationService: SimulationService
): Promise<SimulationResults> {
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

  // Validate DuckDB path exists and is readable
  try {
    accessSync(input.duckdbPath, constants.R_OK);
  } catch (error) {
    throw new Error(
      `DuckDB path is not accessible: ${input.duckdbPath} - ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Create temp directory with permission checks
  const tempDirBase = tmpdir();
  try {
    accessSync(tempDirBase, constants.W_OK);
  } catch (error) {
    throw new Error(
      `Temp directory is not writable: ${tempDirBase} - ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Generate deterministic temp directory name from seed
  const tempDirSuffix = input.seed.toString(36).substring(0, 8);
  const tempDir = mkdtempSync(join(tempDirBase, `sim-results-${tempDirSuffix}-`));

  // Validate temp directory was created and is writable
  try {
    accessSync(tempDir, constants.W_OK);
  } catch (error) {
    throw new Error(
      `Failed to create writable temp directory: ${tempDir} - ${error instanceof Error ? error.message : String(error)}`
    );
  }

  try {
    // 1. Extract alerts from DuckDB projection
    const alerts = await extractAlertsFromProjection(input.duckdbPath, input.config);

    if (alerts.length === 0) {
      // Return empty results - no alerts found for date range
      // Note: Logging removed for handler purity
      return await writeEmptyResults(tempDir);
    }

    // 2. Convert strategy config to Python format
    const pythonStrategyConfig = convertStrategyConfigToPython(input.config.strategy);

    // 3. Extract lookback/lookforward from params
    const lookbackMinutes = ((input.config.params.preWindowMinutes as number) ?? 240) || 240;
    const lookforwardMinutes = ((input.config.params.postWindowMinutes as number) ?? 1440) || 1440;

    // 4. Prepare batch simulation config
    const mints = alerts.map((a) => a.mint);
    const alertTimestamps = alerts.map((a) => new Date(a.timestamp).toISOString());

    const simulationConfig: SimulationConfig = {
      duckdb_path: input.duckdbPath,
      strategy: pythonStrategyConfig,
      initial_capital: 1000.0, // Default initial capital
      lookback_minutes: lookbackMinutes,
      lookforward_minutes: lookforwardMinutes,
      batch: true,
      mints,
      alert_timestamps: alertTimestamps,
      resume: true, // Skip tokens with insufficient data and continue
    };

    // 5. Run Python simulation
    // Note: Logging removed for handler purity
    const pythonResults = await simulationService.runSimulation(simulationConfig);

    // 6. Convert Python results to our format
    const { trades, diagnostics } = convertPythonResultsToTrades(
      pythonResults,
      alerts,
      input.config
    );

    // 7. Calculate aggregate metrics
    const totalGrossPnl = trades.reduce((sum, t) => sum + t.grossPnl, 0);
    const totalNetPnl = trades.reduce((sum, t) => sum + t.netPnl, 0);
    const totalCosts = trades.reduce(
      (sum, t) => sum + t.entryCosts + t.exitCosts + t.borrowCosts,
      0
    );
    const metrics = calculateMetrics(trades, totalGrossPnl, totalNetPnl, totalCosts);

    // 8. Build equity curve
    const equityCurve = buildEquityCurve(trades);

    // 9. Write results to temp Parquet files
    const results = await writeResultsToParquet(tempDir, trades, metrics, equityCurve, diagnostics);

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
      // Note: Logging removed for handler purity - cleanup happens silently
    } catch {
      // Cleanup errors are ignored - original error is re-thrown
      // Note: Logging removed for handler purity
    }
    throw error;
  }
}

/**
 * Extract alerts from DuckDB projection
 */
async function extractAlertsFromProjection(
  duckdbPath: string,
  config: SimulationInput['config']
): Promise<Array<{ id: string; mint: string; timestamp: number }>> {
  const conn = await openDuckDb(duckdbPath);

  try {
    // Test connection works
    try {
      await conn.all<{ test: number }>('SELECT 1 as test');
    } catch (error) {
      throw new Error(
        `DuckDB connection test failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Load all alerts - select alert_ts_utc as-is, convert to milliseconds in JavaScript
    // Note: alerts_v1 artifacts use 'alert_ts_utc' not 'timestamp', 'alert_id' not 'id'
    const alertRows = await conn.all<Record<string, unknown>>(
      `SELECT alert_id, mint, alert_ts_utc FROM alerts ORDER BY alert_ts_utc ASC`
    );

    // Convert timestamps to milliseconds and filter by date range
    const fromMs = new Date(config.dateRange.from).getTime();
    const toMs = new Date(config.dateRange.to).getTime();

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

    const filteredAlerts = alertRows
      .map((row) => ({
        id: String(row.alert_id),
        mint: String(row.mint),
        timestamp: convertTimestamp(row.alert_ts_utc),
      }))
      .filter((a) => a.timestamp >= fromMs && a.timestamp <= toMs);

    return filteredAlerts;
  } finally {
    // Connection cleanup handled by openDuckDb lifecycle
  }
}

/**
 * Convert TypeScript strategy config to Python format
 */
function convertStrategyConfigToPython(
  strategy: SimulationInput['config']['strategy']
): Record<string, unknown> {
  // Extract entry type
  let entryType = 'immediate';
  if (strategy.entry?.delayCandles && strategy.entry.delayCandles > 0) {
    entryType = 'drop'; // Delay entry is similar to drop-based entry
  }

  // Extract profit targets
  const profitTargets =
    strategy.exit?.targets?.map((t) => ({
      target: t.target,
      percent: t.percent,
    })) || [];

  // Extract stop loss
  let stopLossPct: number | undefined;
  let trailingStopPct: number | undefined;
  let trailingActivationPct: number | undefined;

  if (strategy.stopLoss) {
    if (strategy.stopLoss.type === 'fixed' && strategy.stopLoss.percent !== undefined) {
      stopLossPct = strategy.stopLoss.percent;
    } else if (strategy.stopLoss.type === 'trailing' && strategy.stopLoss.percent !== undefined) {
      stopLossPct = strategy.stopLoss.percent;
      trailingStopPct = strategy.stopLoss.percent;
      trailingActivationPct = strategy.stopLoss.trailingActivationMultiple ?? 0.5;
    }
  }

  // Extract fees and slippage
  const makerFee = (strategy.costs?.entryFee ?? 0) + (strategy.costs?.exitFee ?? 0);
  const takerFee = makerFee; // Use same for maker/taker
  const slippage = strategy.costs?.slippage ?? 0.005; // Default 0.5%

  // Generate deterministic strategy ID from strategy config hash
  // Note: Using hash instead of Date.now() for handler purity
  const strategyConfigStr = JSON.stringify(strategy);
  const hash = createHash('sha256').update(strategyConfigStr).digest('hex').substring(0, 8);

  return {
    strategy_id: `exp-${strategy.name}-${hash}`,
    name: strategy.name,
    entry_type: entryType,
    profit_targets: profitTargets,
    stop_loss_pct: stopLossPct,
    trailing_stop_pct: trailingStopPct,
    trailing_activation_pct: trailingActivationPct,
    maker_fee: makerFee,
    taker_fee: takerFee,
    slippage: slippage,
  };
}

/**
 * Convert Python simulation results to Trade records
 */
function convertPythonResultsToTrades(
  pythonResults: SimulationOutput,
  alerts: Array<{ id: string; mint: string; timestamp: number }>,
  config: SimulationInput['config']
): { trades: Trade[]; diagnostics: Diagnostic[] } {
  const trades: Trade[] = [];
  const diagnostics: Diagnostic[] = [];

  // Map alerts by mint+timestamp for lookup
  const alertMap = new Map<string, { id: string; mint: string; timestamp: number }>();
  for (const alert of alerts) {
    const key = `${alert.mint}:${alert.timestamp}`;
    alertMap.set(key, alert);
  }

  // Process each Python result
  for (const result of pythonResults.results) {
    // Handle errors/skipped
    if (result.error) {
      const alert =
        result.mint && result.alert_timestamp
          ? alertMap.get(`${result.mint}:${new Date(result.alert_timestamp).getTime()}`)
          : null;
      diagnostics.push({
        level: 'error',
        message: result.error,
        timestamp: alert?.timestamp ?? 0, // Use 0 as fallback instead of Date.now() for handler purity
        callId: alert?.id,
      });
      continue;
    }

    if (result.skipped) {
      const alert =
        result.mint && result.alert_timestamp
          ? alertMap.get(`${result.mint}:${new Date(result.alert_timestamp).getTime()}`)
          : null;
      diagnostics.push({
        level: 'warning',
        message: `Skipped: insufficient data (need ${result.lookback_minutes ?? 0}min lookback, ${result.lookforward_minutes ?? 0}min lookforward)`,
        timestamp: alert?.timestamp ?? 0, // Use 0 as fallback instead of Date.now() for handler purity
        callId: alert?.id,
      });
      continue;
    }

    // Extract alert for this result
    const alert =
      result.mint && result.alert_timestamp
        ? alertMap.get(`${result.mint}:${new Date(result.alert_timestamp).getTime()}`)
        : null;

    if (!alert) {
      // Use alert timestamp from result if available, otherwise 0
      const fallbackTimestamp = result.alert_timestamp
        ? new Date(result.alert_timestamp).getTime()
        : 0;
      diagnostics.push({
        level: 'warning',
        message: `No alert found for result: ${result.mint} at ${result.alert_timestamp}`,
        timestamp: fallbackTimestamp, // Use result timestamp instead of Date.now() for handler purity
      });
      continue;
    }

    // Convert Python result to Trade
    // Note: Python results have final_capital, total_return_pct, but we need individual trades
    // For now, create a single trade from the result summary
    // TODO: Parse events from Python result if available
    const initialCapital = 1000.0; // Default
    const finalCapital = result.final_capital ?? initialCapital;
    const totalReturnPct = result.total_return_pct ?? 0;
    const grossPnl = (totalReturnPct / 100) * initialCapital;
    const netPnl = grossPnl; // Python already accounts for fees

    // Estimate entry/exit from alert timestamp
    const entryTime = alert.timestamp;
    const exitTime =
      alert.timestamp + ((config.params.postWindowMinutes as number) ?? 1440) * 60 * 1000;

    trades.push({
      tradeId: `${alert.id}-0`,
      callId: alert.id,
      mint: alert.mint,
      entryTime,
      entryPrice: initialCapital, // Estimate - Python should provide this
      exitTime,
      exitPrice: finalCapital, // Estimate - Python should provide this
      exitReason: 'final',
      size: 1,
      grossPnl,
      netPnl,
      entryCosts: 0, // Python accounts for fees
      exitCosts: 0,
      borrowCosts: 0,
      peakMultiple: 1 + totalReturnPct / 100,
      maxDrawdown: 0, // Python should provide this
      duration: exitTime - entryTime,
    });
  }

  return { trades, diagnostics };
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
  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
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
  if (trades.length === 0) {
    return [];
  }

  // Sort trades by entry time
  const sortedTrades = [...trades].sort((a, b) => a.entryTime - b.entryTime);

  const curve: EquityPoint[] = [];
  let cumulativePnl = 0;
  let openPositions = 0;

  for (const trade of sortedTrades) {
    // Entry point
    openPositions++;
    cumulativePnl += trade.netPnl;
    curve.push({
      timestamp: trade.entryTime,
      equity: 1000 + cumulativePnl, // Starting equity + cumulative PnL
      cumulativePnl,
      openPositions,
    });

    // Exit point
    openPositions--;
    curve.push({
      timestamp: trade.exitTime,
      equity: 1000 + cumulativePnl,
      cumulativePnl,
      openPositions,
    });
  }

  return curve;
}

/**
 * Write empty results to Parquet files
 */
async function writeEmptyResults(tempDir: string): Promise<SimulationResults> {
  const tradesPath = join(tempDir, 'trades.parquet');
  const metricsPath = join(tempDir, 'metrics.parquet');
  const curvesPath = join(tempDir, 'curves.parquet');

  // Create empty Parquet files using DuckDB
  const { DuckDBClient } = await import('@quantbot/infra/storage');
  const db = new DuckDBClient(':memory:');

  try {
    await db.execute('INSTALL parquet');
    await db.execute('LOAD parquet');

    // Create empty tables with correct schemas
    await db.execute(`
      CREATE TABLE trades (
        trade_id VARCHAR,
        call_id VARCHAR,
        mint VARCHAR,
        entry_time BIGINT,
        entry_price DOUBLE,
        exit_time BIGINT,
        exit_price DOUBLE,
        exit_reason VARCHAR,
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

    await db.execute(`
      CREATE TABLE metrics (
        total_trades INTEGER,
        winning_trades INTEGER,
        losing_trades INTEGER,
        win_rate DOUBLE,
        avg_win DOUBLE,
        avg_loss DOUBLE,
        profit_factor DOUBLE,
        total_pnl DOUBLE,
        total_gross_pnl DOUBLE,
        total_costs DOUBLE,
        avg_duration DOUBLE,
        max_drawdown DOUBLE,
        sharpe_ratio DOUBLE,
        sortino_ratio DOUBLE
      )
    `);

    await db.execute(`
      CREATE TABLE curves (
        timestamp BIGINT,
        equity DOUBLE,
        cumulative_pnl DOUBLE,
        open_positions INTEGER
      )
    `);

    // Write empty tables to Parquet
    await db.execute(`COPY trades TO '${tradesPath}' (FORMAT PARQUET)`);
    await db.execute(`COPY metrics TO '${metricsPath}' (FORMAT PARQUET)`);
    await db.execute(`COPY curves TO '${curvesPath}' (FORMAT PARQUET)`);
  } finally {
    await db.close();
  }

  return {
    tradesPath,
    metricsPath,
    curvesPath,
    inputArtifactIds: [],
  };
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
  const tradesPath = join(tempDir, 'trades.parquet');
  const metricsPath = join(tempDir, 'metrics.parquet');
  const curvesPath = join(tempDir, 'curves.parquet');
  const diagnosticsPath = join(tempDir, 'diagnostics.parquet');

  const { DuckDBClient } = await import('@quantbot/infra/storage');
  // Use a temporary file-based database instead of :memory: to enable COPY TO PARQUET
  const tempDbPath = join(tempDir, 'temp.duckdb');
  const db = new DuckDBClient(tempDbPath);

  try {
    // Ensure temp directory exists and is writable
    try {
      accessSync(tempDir, constants.W_OK);
    } catch (error) {
      throw new Error(
        `Temp directory not writable: ${tempDir} - ${error instanceof Error ? error.message : String(error)}`
      );
    }

    await db.execute('INSTALL parquet');
    await db.execute('LOAD parquet');

    // Write trades to Parquet
    if (trades.length > 0) {
      await db.execute(`
        CREATE TABLE trades AS
        SELECT * FROM (
          VALUES ${trades
            .map(
              (t) =>
                `('${t.tradeId.replace(/'/g, "''")}', '${t.callId.replace(/'/g, "''")}', '${t.mint.replace(/'/g, "''")}', ${t.entryTime}, ${t.entryPrice}, ${t.exitTime}, ${t.exitPrice}, '${t.exitReason}', ${t.size}, ${t.grossPnl}, ${t.netPnl}, ${t.entryCosts}, ${t.exitCosts}, ${t.borrowCosts}, ${t.peakMultiple}, ${t.maxDrawdown}, ${t.duration})`
            )
            .join(', ')}
        ) AS t(trade_id, call_id, mint, entry_time, entry_price, exit_time, exit_price, exit_reason, size, gross_pnl, net_pnl, entry_costs, exit_costs, borrow_costs, peak_multiple, max_drawdown, duration)
      `);

      // Use absolute path and escape single quotes for SQL
      const escapedTradesPath = resolve(tradesPath).replace(/'/g, "''");
      try {
        await db.execute(`COPY trades TO '${escapedTradesPath}' (FORMAT PARQUET)`);
      } catch (copyError) {
        throw new Error(
          `Failed to copy trades to Parquet: ${copyError instanceof Error ? copyError.message : String(copyError)}`
        );
      }
    } else {
      // Create empty Parquet file
      await db.execute(`
        CREATE TABLE trades (
          trade_id VARCHAR,
          call_id VARCHAR,
          mint VARCHAR,
          entry_time BIGINT,
          entry_price DOUBLE,
          exit_time BIGINT,
          exit_price DOUBLE,
          exit_reason VARCHAR,
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
      // Use absolute path and escape single quotes for SQL
      const escapedTradesPath = resolve(tradesPath).replace(/'/g, "''");
      try {
        await db.execute(`COPY trades TO '${escapedTradesPath}' (FORMAT PARQUET)`);
      } catch (copyError) {
        throw new Error(
          `Failed to copy trades to Parquet: ${copyError instanceof Error ? copyError.message : String(copyError)}`
        );
      }
    }

    // Write metrics to Parquet
    await db.execute(`
      CREATE TABLE metrics AS
      SELECT * FROM (
        VALUES (${metrics.totalTrades}, ${metrics.winningTrades}, ${metrics.losingTrades}, ${metrics.winRate}, ${metrics.avgWin}, ${metrics.avgLoss}, ${metrics.profitFactor}, ${metrics.totalPnl}, ${metrics.totalGrossPnl}, ${metrics.totalCosts}, ${metrics.avgDuration}, ${metrics.maxDrawdown}, ${metrics.sharpeRatio}, ${metrics.sortinoRatio})
      ) AS m(total_trades, winning_trades, losing_trades, win_rate, avg_win, avg_loss, profit_factor, total_pnl, total_gross_pnl, total_costs, avg_duration, max_drawdown, sharpe_ratio, sortino_ratio)
    `);
    const escapedMetricsPath = resolve(metricsPath).replace(/'/g, "''");
    try {
      await db.execute(`COPY metrics TO '${escapedMetricsPath}' (FORMAT PARQUET)`);
    } catch (copyError) {
      throw new Error(
        `Failed to copy metrics to Parquet: ${copyError instanceof Error ? copyError.message : String(copyError)}`
      );
    }

    // Write equity curve to Parquet
    if (equityCurve.length > 0) {
      await db.execute(`
        CREATE TABLE curves AS
        SELECT * FROM (
          VALUES ${equityCurve
            .map((p) => `(${p.timestamp}, ${p.equity}, ${p.cumulativePnl}, ${p.openPositions})`)
            .join(', ')}
        ) AS c(timestamp, equity, cumulative_pnl, open_positions)
      `);
      const escapedCurvesPath = resolve(curvesPath).replace(/'/g, "''");
      try {
        await db.execute(`COPY curves TO '${escapedCurvesPath}' (FORMAT PARQUET)`);
      } catch (copyError) {
        throw new Error(
          `Failed to copy curves to Parquet: ${copyError instanceof Error ? copyError.message : String(copyError)}`
        );
      }
    } else {
      await db.execute(`
        CREATE TABLE curves (
          timestamp BIGINT,
          equity DOUBLE,
          cumulative_pnl DOUBLE,
          open_positions INTEGER
        )
      `);
      const escapedCurvesPath = resolve(curvesPath).replace(/'/g, "''");
      try {
        await db.execute(`COPY curves TO '${escapedCurvesPath}' (FORMAT PARQUET)`);
      } catch (copyError) {
        throw new Error(
          `Failed to copy curves to Parquet: ${copyError instanceof Error ? copyError.message : String(copyError)}`
        );
      }
    }

    // Write diagnostics to Parquet (if any)
    if (diagnostics.length > 0) {
      await db.execute(`
        CREATE TABLE diagnostics AS
        SELECT * FROM (
          VALUES ${diagnostics
            .map(
              (d) =>
                `('${d.level}', '${d.message.replace(/'/g, "''")}', ${d.timestamp}, ${d.callId ? `'${d.callId.replace(/'/g, "''")}'` : 'NULL'}, ${d.context ? `'${JSON.stringify(d.context).replace(/'/g, "''")}'` : 'NULL'})`
            )
            .join(', ')}
        ) AS diag(level, message, timestamp, call_id, context)
      `);
      const escapedDiagnosticsPath = resolve(diagnosticsPath).replace(/'/g, "''");
      try {
        await db.execute(`COPY diagnostics TO '${escapedDiagnosticsPath}' (FORMAT PARQUET)`);
      } catch (copyError) {
        throw new Error(
          `Failed to copy diagnostics to Parquet: ${copyError instanceof Error ? copyError.message : String(copyError)}`
        );
      }
    }

    // Verify files were created (with a small delay to allow file system to sync)
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      accessSync(tradesPath, constants.R_OK);
      accessSync(metricsPath, constants.R_OK);
      accessSync(curvesPath, constants.R_OK);
      if (diagnostics.length > 0) {
        accessSync(diagnosticsPath, constants.R_OK);
      }
    } catch (fileError) {
      throw new Error(
        `Parquet files were not created: ${fileError instanceof Error ? fileError.message : String(fileError)}`
      );
    }
  } catch (error) {
    // Close database connection before re-throwing
    await db.close().catch(() => {
      // Ignore close errors
    });
    throw new Error(
      `Failed to write Parquet files: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await db.close();
    // Clean up temporary database file
    try {
      const { unlinkSync } = await import('node:fs');
      unlinkSync(tempDbPath);
    } catch {
      // Ignore cleanup errors - file may not exist or already deleted
    }
  }

  return {
    tradesPath,
    metricsPath,
    curvesPath,
    diagnosticsPath: diagnostics.length > 0 ? diagnosticsPath : undefined,
  };
}
