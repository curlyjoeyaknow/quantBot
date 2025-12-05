/**
 * Results & Visualization Service
 * 
 * Generates aggregated summaries, performance metrics, and chart data
 * for backtest results.
 */

import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import * as sqlite3 from 'sqlite3';
import { promisify } from 'util';
import * as path from 'path';
import { ohlcvService } from './ohlcv-service';

const DB_PATH = path.join(process.cwd(), 'simulations.db');

export interface PerformanceMetrics {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  winRate: number;
  averagePnl: number;
  totalPnl: number;
  maxPnl: number;
  minPnl: number;
  maxDrawdown: number;
  averageCandles: number;
  sharpeRatio?: number;
}

export interface ChartDataPoint {
  timestamp: number;
  price: number;
  pnl?: number;
  event?: string;
}

export interface ChartData {
  priceChart: ChartDataPoint[];
  pnlChart: ChartDataPoint[];
  tradeDistribution: {
    profitable: number;
    losing: number;
    breakeven: number;
  };
}

/**
 * Results Service for aggregating and visualizing backtest results
 */
export class ResultsService {
  /**
   * Aggregate results across multiple backtest runs
   */
  async aggregateResults(runIds: number[]): Promise<{
    metrics: PerformanceMetrics;
    runs: any[];
  }> {
    if (runIds.length === 0) {
      return {
        metrics: this.getEmptyMetrics(),
        runs: [],
      };
    }

    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(DB_PATH, (err) => {
        if (err) {
          return reject(err);
        }

        const placeholders = runIds.map(() => '?').join(',');
        const query = `
          SELECT 
            id,
            mint,
            chain,
            token_name,
            token_symbol,
            final_pnl,
            total_candles,
            entry_price,
            entry_timestamp,
            created_at
          FROM simulation_runs
          WHERE id IN (${placeholders})
        `;

        db.all(query, runIds, (err, rows: any[]) => {
          db.close();
          if (err) {
            return reject(err);
          }

          const runs = rows.map((row) => ({
            id: row.id,
            mint: row.mint,
            chain: row.chain,
            tokenName: row.token_name,
            tokenSymbol: row.token_symbol,
            finalPnl: row.final_pnl,
            totalCandles: row.total_candles,
            entryPrice: row.entry_price,
            entryTimestamp: row.entry_timestamp,
            createdAt: row.created_at,
          }));

          const metrics = this.calculateMetrics(runs);

          resolve({ metrics, runs });
        });
      });
    });
  }

  /**
   * Generate chart data for a single backtest run
   */
  async generateChartData(runId: number): Promise<ChartData> {
    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(DB_PATH, (err) => {
        if (err) {
          return reject(err);
        }

        // Get run details
        db.get(
          'SELECT * FROM simulation_runs WHERE id = ?',
          [runId],
          async (err, run: any) => {
            if (err) {
              db.close();
              return reject(err);
            }

            if (!run) {
              db.close();
              return reject(new Error('Run not found'));
            }

            // Get events
            db.all(
              'SELECT * FROM simulation_events WHERE run_id = ? ORDER BY timestamp',
              [runId],
              async (err, events: any[]) => {
                db.close();
                if (err) {
                  return reject(err);
                }

                try {
                  // Fetch candles for the time range
                  const startTime = DateTime.fromISO(run.start_time);
                  const endTime = DateTime.fromISO(run.end_time);

                  const candles = await ohlcvService.getCandles(
                    run.mint,
                    run.chain,
                    startTime,
                    endTime,
                    { interval: '5m', useCache: true }
                  );

                  // Generate price chart with entry/exit markers
                  const priceChart: ChartDataPoint[] = candles.map((candle) => {
                    const event = events.find(
                      (e) =>
                        Math.abs(e.timestamp - candle.timestamp) < 300 // Within 5 minutes
                    );

                    return {
                      timestamp: candle.timestamp,
                      price: candle.close,
                      event: event?.event_type,
                    };
                  });

                  // Generate PNL chart
                  const pnlChart: ChartDataPoint[] = events.map((event: any) => ({
                    timestamp: event.timestamp,
                    pnl: event.pnl_so_far,
                    price: event.price || 0, // Add missing required field
                  }));

                  // Calculate trade distribution
                  const tradeDistribution = {
                    profitable: events.filter((e) => e.pnl_so_far > 0).length,
                    losing: events.filter((e) => e.pnl_so_far < 0).length,
                    breakeven: events.filter((e) => e.pnl_so_far === 0).length,
                  };

                  resolve({
                    priceChart,
                    pnlChart,
                    tradeDistribution,
                  });
                } catch (error: any) {
                  reject(error);
                }
              }
            );
          }
        );
      });
    });
  }

  /**
   * Calculate performance metrics from runs
   */
  private calculateMetrics(runs: any[]): PerformanceMetrics {
    if (runs.length === 0) {
      return this.getEmptyMetrics();
    }

    const pnls = runs.map((r) => r.finalPnl);
    const successfulRuns = runs.filter((r) => r.finalPnl > 0).length;
    const failedRuns = runs.filter((r) => r.finalPnl <= 0).length;

    const totalPnl = pnls.reduce((sum, pnl) => sum + pnl, 0);
    const averagePnl = totalPnl / runs.length;
    const maxPnl = Math.max(...pnls);
    const minPnl = Math.min(...pnls);
    const winRate = successfulRuns / runs.length;

    // Calculate max drawdown
    let maxDrawdown = 0;
    let peak = pnls[0];
    for (const pnl of pnls) {
      if (pnl > peak) {
        peak = pnl;
      }
      const drawdown = peak - pnl;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    // Calculate average candles
    const totalCandles = runs.reduce((sum, r) => sum + (r.totalCandles || 0), 0);
    const averageCandles = totalCandles / runs.length;

    // Calculate Sharpe ratio (simplified - would need risk-free rate for full calculation)
    const variance =
      pnls.reduce((sum, pnl) => sum + Math.pow(pnl - averagePnl, 2), 0) /
      runs.length;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? averagePnl / stdDev : undefined;

    return {
      totalRuns: runs.length,
      successfulRuns,
      failedRuns,
      winRate,
      averagePnl,
      totalPnl,
      maxPnl,
      minPnl,
      maxDrawdown,
      averageCandles,
      sharpeRatio,
    };
  }

  /**
   * Get empty metrics structure
   */
  private getEmptyMetrics(): PerformanceMetrics {
    return {
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      winRate: 0,
      averagePnl: 0,
      totalPnl: 0,
      maxPnl: 0,
      minPnl: 0,
      maxDrawdown: 0,
      averageCandles: 0,
    };
  }

  /**
   * Compare multiple strategies
   */
  async compareStrategies(strategyIds: number[], userId: number): Promise<{
    strategies: Array<{
      strategyId: number;
      strategyName: string;
      metrics: PerformanceMetrics;
    }>;
  }> {
    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(DB_PATH, (err) => {
        if (err) {
          return reject(err);
        }

        // Get strategy names
        const placeholders = strategyIds.map(() => '?').join(',');
        db.all(
          `SELECT id, name FROM strategies WHERE id IN (${placeholders}) AND user_id = ?`,
          [...strategyIds, userId],
          (err, strategies: any[]) => {
            if (err) {
              db.close();
              return reject(err);
            }

            // Get runs for each strategy
            const strategyMetrics = strategies.map((strategy) => {
              return new Promise((resolve) => {
                db.all(
                  `SELECT final_pnl, total_candles FROM simulation_runs WHERE strategy_name = ?`,
                  [strategy.name],
                  (err, runs: any[]) => {
                    if (err) {
                      resolve({
                        strategyId: strategy.id,
                        strategyName: strategy.name,
                        metrics: this.getEmptyMetrics(),
                      });
                      return;
                    }

                    const metrics = this.calculateMetrics(
                      runs.map((r) => ({
                        finalPnl: r.final_pnl,
                        totalCandles: r.total_candles,
                      }))
                    );

                    resolve({
                      strategyId: strategy.id,
                      strategyName: strategy.name,
                      metrics,
                    });
                  }
                );
              });
            });

            Promise.all(strategyMetrics).then((results) => {
              db.close();
              resolve({ strategies: results as any });
            });
          }
        );
      });
    });
  }
}

// Export singleton instance
export const resultsService = new ResultsService();

