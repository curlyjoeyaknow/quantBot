/**
 * Dashboard Service - PostgreSQL Version
 * Provides dashboard metrics from PostgreSQL instead of SQLite
 */

import { postgresManager } from '../db/postgres-manager';
import { cache, cacheKeys } from '../cache';
import { CONSTANTS } from '../constants';
import { DashboardMetrics } from '../types/api';

export class DashboardServicePostgres {
  /**
   * Get dashboard metrics from PostgreSQL
   */
  async getMetrics(): Promise<DashboardMetrics> {
    try {
      // Check cache first
      const cacheKey = cacheKeys.dashboard();
      const cached = cache.get<DashboardMetrics>(cacheKey);
      if (cached) {
        return cached;
      }

      // Try to get pre-computed metrics from dashboard_metrics table
      const precomputedResult = await postgresManager.query(`
        SELECT *
        FROM dashboard_metrics
        ORDER BY computed_at DESC
        LIMIT 1
      `);

      if (precomputedResult.rows.length > 0) {
        const row = precomputedResult.rows[0];
        
        // Check if metrics are recent (less than 2 hours old)
        const computedAt = new Date(row.computed_at);
        const ageMs = Date.now() - computedAt.getTime();
        const maxAgeMs = 2 * 60 * 60 * 1000; // 2 hours

        if (ageMs < maxAgeMs) {
          const metrics: DashboardMetrics = {
            totalCalls: parseInt(row.total_calls),
            pnlFromAlerts: parseFloat(row.pnl_from_alerts),
            maxDrawdown: parseFloat(row.max_drawdown),
            currentDailyProfit: parseFloat(row.current_daily_profit),
            lastWeekDailyProfit: parseFloat(row.last_week_daily_profit),
            overallProfit: parseFloat(row.overall_profit),
            largestGain: parseFloat(row.largest_gain),
            profitSinceOctober: parseFloat(row.profit_since_october),
          };

          cache.set(cacheKey, metrics, CONSTANTS.CACHE_TTL.DASHBOARD);
          return metrics;
        }
      }

      // Fallback: compute on-demand from alerts
      const metricsResult = await postgresManager.query(`
        SELECT 
          COUNT(*) as total_calls,
          COUNT(DISTINCT token_id) as unique_tokens,
          MIN(alert_timestamp) as first_alert,
          MAX(alert_timestamp) as last_alert
        FROM alerts
      `);

      const row = metricsResult.rows[0];

      const metrics: DashboardMetrics = {
        totalCalls: parseInt(row.total_calls),
        pnlFromAlerts: 0, // Would need strategy results to calculate
        maxDrawdown: 0,
        currentDailyProfit: 0,
        lastWeekDailyProfit: 0,
        overallProfit: 0,
        largestGain: 0,
        profitSinceOctober: 0,
      };

      cache.set(cacheKey, metrics, CONSTANTS.CACHE_TTL.DASHBOARD);
      return metrics;
    } catch (error) {
      console.error('Error fetching dashboard metrics:', error);
      throw error;
    }
  }

  /**
   * Get database statistics
   */
  async getDatabaseStats() {
    try {
      const result = await postgresManager.query(`
        SELECT 
          (SELECT COUNT(*) FROM alerts) as total_alerts,
          (SELECT COUNT(*) FROM tokens) as total_tokens,
          (SELECT COUNT(*) FROM callers) as total_callers,
          (SELECT COUNT(*) FROM strategies) as total_strategies,
          (SELECT COUNT(*) FROM simulation_runs) as total_simulations,
          (SELECT pg_size_pretty(pg_database_size(current_database()))) as database_size
      `);

      return result.rows[0];
    } catch (error) {
      console.error('Error fetching database stats:', error);
      throw error;
    }
  }
}

export const dashboardServicePostgres = new DashboardServicePostgres();

