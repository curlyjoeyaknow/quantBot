/**
 * Performance Analytics Service - PostgreSQL + ClickHouse Version
 * Advanced analytics for caller and strategy performance with real OHLCV data
 */

import { postgresManager } from '../db/postgres-manager';
import { cache } from '../cache';
import { performanceCalculator } from './performance-calculator';

// Bot callers to exclude (they just log calls, not make them)
const BOT_CALLERS = ['Phanes [Gold]', 'Rick', 'Phanes', 'phanes'];

export interface CallerPerformanceMetrics {
  callerName: string;
  totalCalls: number;
  avgMultiple: number;
  bestMultiple: number;
  avgTimeToATH: number; // in minutes
  medianTimeToATH: number;
  winRate: number; // percentage of calls that went positive
  profitableCalls: number;
  totalReturn: number;
}

export interface StrategyPerformance {
  strategyName: string;
  totalRuns: number;
  avgPnl: number;
  winRate: number;
  bestPnl: number;
  worstPnl: number;
  sharpeRatio?: number;
  maxDrawdown?: number;
  avgHoldingTime: number;
}

export interface CallerByStrategy {
  callerName: string;
  strategyName: string;
  callCount: number;
  avgMultiple: number;
  winRate: number;
  bestCall: number;
}

export interface TopCall {
  callerName: string;
  tokenSymbol: string;
  tokenAddress: string;
  multiple: number;
  timeToATH: number; // minutes
  alertTime: Date;
  peakPrice: number;
  entryPrice: number;
}

export class PerformanceAnalyticsService {
  /**
   * Get top callers by return multiple (with real OHLCV data)
   */
  async getTopCallersByReturns(limit: number = 10): Promise<CallerPerformanceMetrics[]> {
    try {
      const cacheKey = `perf:top-callers-returns:${limit}`;
      const cached = cache.get<CallerPerformanceMetrics[]>(cacheKey);
      if (cached) return cached;

      // Get alerts for each caller (limit to last 100 per caller for performance)
      const result = await postgresManager.query(
        `
        WITH caller_alerts AS (
          SELECT 
            c.id as caller_id,
            c.handle as caller_name,
            a.id as alert_id,
            t.address as token_address,
            t.chain,
            a.alert_timestamp,
            a.alert_price,
            ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY a.alert_timestamp DESC) as rn
          FROM callers c
          INNER JOIN alerts a ON a.caller_id = c.id
          INNER JOIN tokens t ON t.id = a.token_id
          WHERE c.handle NOT IN (${BOT_CALLERS.map((_, i) => `$${i + 1}`).join(', ')})
          AND a.alert_price IS NOT NULL
          AND a.alert_price > 0
        )
        SELECT 
          caller_id,
          caller_name,
          COUNT(*) as total_calls,
          jsonb_agg(
            jsonb_build_object(
              'alert_id', alert_id,
              'token_address', token_address,
              'chain', chain,
              'alert_timestamp', alert_timestamp,
              'alert_price', alert_price
            )
          ) FILTER (WHERE rn <= 100) as recent_alerts
        FROM caller_alerts
        GROUP BY caller_id, caller_name
        HAVING COUNT(*) >= 1
        ORDER BY total_calls DESC
        LIMIT $${BOT_CALLERS.length + 1}
        `,
        [...BOT_CALLERS, limit]
      );

      const data: CallerPerformanceMetrics[] = [];

      for (const row of result.rows) {
        const recentAlerts = row.recent_alerts || [];
        
        // Calculate performance for recent alerts
        const performancePromises = recentAlerts.map((alert: any) =>
          performanceCalculator.calculateAlertPerformance(
            alert.token_address,
            alert.chain,
            new Date(alert.alert_timestamp),
            parseFloat(alert.alert_price)
          )
        );

        const performances = await Promise.all(performancePromises);
        const validPerformances = performances.filter((p): p is NonNullable<typeof p> => p !== null);

        if (validPerformances.length > 0) {
          const multiples = validPerformances.map(p => p.multiple);
          const times = validPerformances.map(p => p.timeToATHMinutes);
          
          const avgMultiple = multiples.reduce((sum, m) => sum + m, 0) / multiples.length;
          const bestMultiple = Math.max(...multiples);
          const avgTimeToATH = times.reduce((sum, t) => sum + t, 0) / times.length;
          const profitableCalls = multiples.filter(m => m > 1.1).length;
          const winRate = (profitableCalls / multiples.length) * 100;

          data.push({
            callerName: row.caller_name,
            totalCalls: parseInt(row.total_calls),
            avgMultiple,
            bestMultiple,
            avgTimeToATH,
            medianTimeToATH: times.sort((a, b) => a - b)[Math.floor(times.length / 2)] || 0,
            winRate,
            profitableCalls,
            totalReturn: avgMultiple * multiples.length,
          });
        }
      }

      // Sort by avg multiple
      data.sort((a, b) => b.avgMultiple - a.avgMultiple);

      cache.set(cacheKey, data, 600); // 10 minutes
      return data;
    } catch (error) {
      console.error('Error fetching top callers by returns:', error);
      throw error;
    }
  }

  /**
   * Get highest multiple calls (with real OHLCV data from ClickHouse)
   */
  async getHighestMultipleCalls(limit: number = 50): Promise<TopCall[]> {
    try {
      const cacheKey = `perf:highest-multiple:${limit}`;
      const cached = cache.get<TopCall[]>(cacheKey);
      if (cached) return cached;

      // Get sample of recent alerts to calculate from
      const result = await postgresManager.query(
        `
        SELECT 
          c.handle as caller_name,
          t.symbol as token_symbol,
          t.address as token_address,
          t.chain,
          a.alert_price as entry_price,
          a.alert_timestamp
        FROM alerts a
        LEFT JOIN callers c ON c.id = a.caller_id
        LEFT JOIN tokens t ON t.id = a.token_id
        WHERE c.handle NOT IN (${BOT_CALLERS.map((_, i) => `$${i + 1}`).join(', ')})
        AND a.alert_price IS NOT NULL
        AND a.alert_price > 0
        AND a.alert_timestamp > '2025-01-01'
        ORDER BY a.alert_timestamp DESC
        LIMIT 500
        `,
        [...BOT_CALLERS]
      );

      // Calculate performance for each alert using ClickHouse
      const callsWithPerformance: TopCall[] = [];
      
      for (const row of result.rows) {
        const performance = await performanceCalculator.calculateAlertPerformance(
          row.token_address,
          row.chain,
          new Date(row.alert_timestamp),
          parseFloat(row.entry_price)
        );

        if (performance && performance.multiple > 1.0) {
          callsWithPerformance.push({
            callerName: row.caller_name,
            tokenSymbol: row.token_symbol || 'Unknown',
            tokenAddress: row.token_address,
            multiple: performance.multiple,
            timeToATH: performance.timeToATHMinutes,
            alertTime: new Date(row.alert_timestamp),
            peakPrice: performance.peakPrice,
            entryPrice: parseFloat(row.entry_price),
          });
        }
      }

      // Sort by multiple and take top N
      callsWithPerformance.sort((a, b) => b.multiple - a.multiple);
      const topCalls = callsWithPerformance.slice(0, limit);

      cache.set(cacheKey, topCalls, 600);
      return topCalls;
    } catch (error) {
      console.error('Error fetching highest multiple calls:', error);
      // Return empty array on error
      return [];
    }
  }

  /**
   * Get strategy performance comparison
   */
  async getStrategyPerformance(): Promise<StrategyPerformance[]> {
    try {
      const cacheKey = 'perf:strategy-performance';
      const cached = cache.get<StrategyPerformance[]>(cacheKey);
      if (cached) return cached;

      const result = await postgresManager.query(`
        SELECT 
          s.name as strategy_name,
          COUNT(sr.id) as total_runs,
          COALESCE(AVG(srs.final_pnl), 0) as avg_pnl,
          COALESCE(COUNT(CASE WHEN srs.final_pnl > 0 THEN 1 END)::FLOAT / NULLIF(COUNT(sr.id), 0) * 100, 0) as win_rate,
          COALESCE(MAX(srs.final_pnl), 0) as best_pnl,
          COALESCE(MIN(srs.final_pnl), 0) as worst_pnl,
          AVG(srs.sharpe_ratio) as sharpe_ratio,
          AVG(srs.max_drawdown) as max_drawdown,
          COALESCE(AVG(srs.average_holding_minutes), 0) as avg_holding_time
        FROM strategies s
        LEFT JOIN simulation_runs sr ON sr.strategy_id = s.id
        LEFT JOIN simulation_results_summary srs ON srs.simulation_run_id = sr.id
        WHERE sr.status = 'completed' OR sr.id IS NULL
        GROUP BY s.id, s.name
        HAVING COUNT(sr.id) > 0
        ORDER BY avg_pnl DESC
      `);

      const data: StrategyPerformance[] = result.rows.map((row: any) => ({
        strategyName: row.strategy_name,
        totalRuns: parseInt(row.total_runs) || 0,
        avgPnl: parseFloat(row.avg_pnl) || 0,
        winRate: parseFloat(row.win_rate) || 0,
        bestPnl: parseFloat(row.best_pnl) || 0,
        worstPnl: parseFloat(row.worst_pnl) || 0,
        sharpeRatio: row.sharpe_ratio ? parseFloat(row.sharpe_ratio) : undefined,
        maxDrawdown: row.max_drawdown ? parseFloat(row.max_drawdown) : undefined,
        avgHoldingTime: parseFloat(row.avg_holding_time) || 0,
      }));

      cache.set(cacheKey, data, 600);
      return data;
    } catch (error) {
      console.error('Error fetching strategy performance:', error);
      // Return empty array if no strategies yet
      return [];
    }
  }

  /**
   * Get individual strategy analytics
   */
  async getStrategyAnalytics(strategyName: string): Promise<{
    overview: StrategyPerformance | null;
    recentRuns: any[];
    topPerformers: any[];
    metrics: any;
  }> {
    try {
      const cacheKey = `perf:strategy-analytics:${strategyName}`;
      const cached = cache.get<any>(cacheKey);
      if (cached) return cached;

      // Get strategy overview
      const overviewResult = await postgresManager.query(
        `
        SELECT 
          s.name as strategy_name,
          COUNT(sr.id) as total_runs,
          COALESCE(AVG(srs.final_pnl), 0) as avg_pnl,
          COALESCE(COUNT(CASE WHEN srs.final_pnl > 0 THEN 1 END)::FLOAT / NULLIF(COUNT(sr.id), 0) * 100, 0) as win_rate,
          COALESCE(MAX(srs.final_pnl), 0) as best_pnl,
          COALESCE(MIN(srs.final_pnl), 0) as worst_pnl,
          AVG(srs.sharpe_ratio) as sharpe_ratio,
          AVG(srs.max_drawdown) as max_drawdown,
          COALESCE(AVG(srs.average_holding_minutes), 0) as avg_holding_time
        FROM strategies s
        LEFT JOIN simulation_runs sr ON sr.strategy_id = s.id
        LEFT JOIN simulation_results_summary srs ON srs.simulation_run_id = sr.id
        WHERE s.name = $1 AND (sr.status = 'completed' OR sr.id IS NULL)
        GROUP BY s.id, s.name
        `,
        [strategyName]
      );

      // Get recent runs
      const recentRunsResult = await postgresManager.query(
        `
        SELECT 
          sr.id,
          t.symbol as token_symbol,
          sr.started_at,
          sr.completed_at,
          COALESCE(srs.final_pnl, 0) as final_pnl,
          COALESCE(srs.win_rate, 0) as win_rate,
          COALESCE(srs.trade_count, 0) as trade_count,
          COALESCE(srs.max_drawdown, 0) as max_drawdown
        FROM simulation_runs sr
        LEFT JOIN strategies s ON s.id = sr.strategy_id
        LEFT JOIN tokens t ON t.id = sr.token_id
        LEFT JOIN simulation_results_summary srs ON srs.simulation_run_id = sr.id
        WHERE s.name = $1 AND sr.status = 'completed'
        ORDER BY sr.completed_at DESC
        LIMIT 10
        `,
        [strategyName]
      );

      const overview = overviewResult.rows[0] ? {
        strategyName: overviewResult.rows[0].strategy_name,
        totalRuns: parseInt(overviewResult.rows[0].total_runs) || 0,
        avgPnl: parseFloat(overviewResult.rows[0].avg_pnl) || 0,
        winRate: parseFloat(overviewResult.rows[0].win_rate) || 0,
        bestPnl: parseFloat(overviewResult.rows[0].best_pnl) || 0,
        worstPnl: parseFloat(overviewResult.rows[0].worst_pnl) || 0,
        sharpeRatio: overviewResult.rows[0].sharpe_ratio ? parseFloat(overviewResult.rows[0].sharpe_ratio) : undefined,
        maxDrawdown: overviewResult.rows[0].max_drawdown ? parseFloat(overviewResult.rows[0].max_drawdown) : undefined,
        avgHoldingTime: parseFloat(overviewResult.rows[0].avg_holding_time) || 0,
      } : null;

      const data = {
        overview,
        recentRuns: recentRunsResult.rows,
        topPerformers: [],
        metrics: {},
      };

      cache.set(cacheKey, data, 300); // 5 minutes
      return data;
    } catch (error) {
      console.error('Error fetching strategy analytics:', error);
      return { overview: null, recentRuns: [], topPerformers: [], metrics: {} };
    }
  }

  /**
   * Get best callers for a specific strategy
   * Simplified version based on call count
   */
  async getBestCallersByStrategy(strategyName: string, limit: number = 10): Promise<CallerByStrategy[]> {
    try {
      const cacheKey = `perf:best-callers-strategy:${strategyName}:${limit}`;
      const cached = cache.get<CallerByStrategy[]>(cacheKey);
      if (cached) return cached;

      // Simplified query based on call count
      const result = await postgresManager.query(
        `
        SELECT 
          c.handle as caller_name,
          $1 as strategy_name,
          COUNT(a.id) as call_count,
          COUNT(CASE WHEN a.confidence > 0.7 THEN 1 END)::FLOAT / NULLIF(COUNT(a.id), 0) * 100 as win_rate_estimate
        FROM callers c
        LEFT JOIN alerts a ON a.caller_id = c.id
        WHERE c.handle NOT IN (${BOT_CALLERS.map((_, i) => `$${i + 2}`).join(', ')})
        GROUP BY c.id, c.handle
        HAVING COUNT(a.id) >= 5
        ORDER BY call_count DESC
        LIMIT $${BOT_CALLERS.length + 2}
        `,
        [strategyName, ...BOT_CALLERS, limit]
      );

      const data: CallerByStrategy[] = result.rows.map((row: any) => ({
        callerName: row.caller_name,
        strategyName: row.strategy_name,
        callCount: parseInt(row.call_count),
        avgMultiple: 1.0, // Placeholder - need OHLCV data
        winRate: parseFloat(row.win_rate_estimate) || 0,
        bestCall: 1.0, // Placeholder - need OHLCV data
      }));

      cache.set(cacheKey, data, 600);
      return data;
    } catch (error) {
      console.error('Error fetching best callers by strategy:', error);
      throw error;
    }
  }
}

export const performanceAnalyticsService = new PerformanceAnalyticsService();
