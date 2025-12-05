/**
 * Dashboard Service
 * ================
 * Business logic for dashboard metrics
 */

import { dashboardMetricsDb } from '../jobs/dashboard-metrics-db';
import { cache, cacheKeys } from '../cache';
import { CONSTANTS } from '../constants';
import { DashboardMetrics } from '../types/api';

export class DashboardService {
  /**
   * Get dashboard metrics
   */
  async getMetrics(): Promise<DashboardMetrics> {
    try {
      // Check cache first
      const cacheKey = cacheKeys.dashboard();
      const cached = cache.get<DashboardMetrics>(cacheKey);
      if (cached) {
        return cached;
      }

      // Try to get pre-computed metrics from database
      let precomputed = null;
      try {
        precomputed = await dashboardMetricsDb.getLatestMetrics();
      } catch (error) {
        console.error('Error fetching pre-computed metrics from database:', error);
        // Continue to fallback
      }
      
      if (precomputed) {
        // Check if metrics are recent (less than 2 hours old)
        const computedAt = new Date(precomputed.computed_at);
        const ageMs = Date.now() - computedAt.getTime();
        const maxAgeMs = 2 * 60 * 60 * 1000; // 2 hours

        if (ageMs < maxAgeMs) {
          const metrics: DashboardMetrics = {
            totalCalls: precomputed.total_calls,
            pnlFromAlerts: precomputed.pnl_from_alerts,
            maxDrawdown: precomputed.max_drawdown,
            currentDailyProfit: precomputed.current_daily_profit,
            lastWeekDailyProfit: precomputed.last_week_daily_profit,
            overallProfit: precomputed.overall_profit,
            largestGain: precomputed.largest_gain,
            profitSinceOctober: precomputed.profit_since_october,
          };

          // Cache for 15 minutes
          try {
            cache.set(cacheKey, metrics, CONSTANTS.CACHE_TTL.DASHBOARD);
          } catch (error) {
            console.error('Error setting cache:', error);
          }
          return metrics;
        }
      }

      // Fallback: compute on-demand if no pre-computed metrics available
      try {
        const { DashboardComputeJob } = await import('../jobs/dashboard-compute-job');
        const dashboardJob = new DashboardComputeJob();
        const metrics = await dashboardJob.run();
        
        const result: DashboardMetrics = {
          totalCalls: metrics.total_calls,
          pnlFromAlerts: metrics.pnl_from_alerts,
          maxDrawdown: metrics.max_drawdown,
          currentDailyProfit: metrics.current_daily_profit,
          lastWeekDailyProfit: metrics.last_week_daily_profit,
          overallProfit: metrics.overall_profit,
          largestGain: metrics.largest_gain,
          profitSinceOctober: metrics.profit_since_october,
        };

        // Cache the result
        try {
          cache.set(cacheKey, result, CONSTANTS.CACHE_TTL.DASHBOARD);
        } catch (error) {
          console.error('Error caching computed metrics:', error);
        }

        return result;
      } catch (error) {
        console.error('Error computing dashboard metrics on-demand:', error);
        // Return zeros as last resort
        return {
          totalCalls: 0,
          pnlFromAlerts: 0,
          maxDrawdown: 0,
          currentDailyProfit: 0,
          lastWeekDailyProfit: 0,
          overallProfit: 0,
          largestGain: 0,
          profitSinceOctober: 0,
        };
      }
    } catch (error) {
      console.error('Unexpected error in getMetrics:', error);
      // Return zeros as absolute last resort
      return {
        totalCalls: 0,
        pnlFromAlerts: 0,
        maxDrawdown: 0,
        currentDailyProfit: 0,
        lastWeekDailyProfit: 0,
        overallProfit: 0,
        largestGain: 0,
        profitSinceOctober: 0,
      };
    }
  }
}

export const dashboardService = new DashboardService();

