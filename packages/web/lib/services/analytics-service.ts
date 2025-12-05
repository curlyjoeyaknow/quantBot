/**
 * Analytics Service - PostgreSQL Version
 * Provides aggregated analytics data for charts and visualizations
 */

import { postgresManager } from '../db/postgres-manager';
import { cache, cacheKeys } from '../cache';
import { startOfDay, subDays, format } from 'date-fns';

export interface CallerPerformance {
  callerName: string;
  totalAlerts: number;
  uniqueTokens: number;
  avgPrice: number;
  firstAlert: Date;
  lastAlert: Date;
}

export interface TimeSeriesPoint {
  date: string;
  count: number;
  value?: number;
}

export interface TokenDistribution {
  chain: string;
  count: number;
  percentage: number;
}

export interface HourlyActivity {
  hour: number;
  count: number;
  avgPrice: number;
}

export interface TopToken {
  symbol: string;
  address: string;
  chain: string;
  alertCount: number;
  uniqueCallers: number;
}

export class AnalyticsService {
  /**
   * Get alerts over time (last 30 days)
   */
  async getAlertsTimeSeries(days: number = 30): Promise<TimeSeriesPoint[]> {
    try {
      const cacheKey = `analytics:alerts-timeseries:${days}`;
      const cached = cache.get<TimeSeriesPoint[]>(cacheKey);
      if (cached) return cached;

      const startDate = subDays(new Date(), days);

      const result = await postgresManager.query(
        `
        SELECT 
          DATE(alert_timestamp) as date,
          COUNT(*) as count
        FROM alerts
        WHERE alert_timestamp >= $1
        GROUP BY DATE(alert_timestamp)
        ORDER BY date ASC
        `,
        [startDate.toISOString()]
      );

      const data: TimeSeriesPoint[] = result.rows.map((row: any) => ({
        date: format(new Date(row.date), 'MMM dd'),
        count: parseInt(row.count),
      }));

      cache.set(cacheKey, data, 300); // 5 minutes
      return data;
    } catch (error) {
      console.error('Error fetching alerts time series:', error);
      throw error;
    }
  }

  /**
   * Get top callers by alert count
   */
  async getTopCallers(limit: number = 10): Promise<CallerPerformance[]> {
    try {
      const cacheKey = `analytics:top-callers:${limit}`;
      const cached = cache.get<CallerPerformance[]>(cacheKey);
      if (cached) return cached;

      const result = await postgresManager.query(
        `
        SELECT 
          c.handle as caller_name,
          COUNT(a.id) as total_alerts,
          COUNT(DISTINCT a.token_id) as unique_tokens,
          AVG(a.alert_price) as avg_price,
          MIN(a.alert_timestamp) as first_alert,
          MAX(a.alert_timestamp) as last_alert
        FROM callers c
        LEFT JOIN alerts a ON a.caller_id = c.id
        GROUP BY c.id, c.handle
        HAVING COUNT(a.id) > 0
        ORDER BY total_alerts DESC
        LIMIT $1
        `,
        [limit]
      );

      const data: CallerPerformance[] = result.rows.map((row: any) => ({
        callerName: row.caller_name,
        totalAlerts: parseInt(row.total_alerts),
        uniqueTokens: parseInt(row.unique_tokens),
        avgPrice: row.avg_price ? parseFloat(row.avg_price) : 0,
        firstAlert: new Date(row.first_alert),
        lastAlert: new Date(row.last_alert),
      }));

      cache.set(cacheKey, data, 600); // 10 minutes
      return data;
    } catch (error) {
      console.error('Error fetching top callers:', error);
      throw error;
    }
  }

  /**
   * Get token distribution by chain
   */
  async getTokenDistribution(): Promise<TokenDistribution[]> {
    try {
      const cacheKey = 'analytics:token-distribution';
      const cached = cache.get<TokenDistribution[]>(cacheKey);
      if (cached) return cached;

      const result = await postgresManager.query(`
        SELECT 
          chain,
          COUNT(*) as count
        FROM tokens
        GROUP BY chain
        ORDER BY count DESC
      `);

      const total = result.rows.reduce((sum: number, row: any) => sum + parseInt(row.count), 0);

      const data: TokenDistribution[] = result.rows.map((row: any) => ({
        chain: row.chain || 'unknown',
        count: parseInt(row.count),
        percentage: (parseInt(row.count) / total) * 100,
      }));

      cache.set(cacheKey, data, 600); // 10 minutes
      return data;
    } catch (error) {
      console.error('Error fetching token distribution:', error);
      throw error;
    }
  }

  /**
   * Get hourly activity patterns
   */
  async getHourlyActivity(): Promise<HourlyActivity[]> {
    try {
      const cacheKey = 'analytics:hourly-activity';
      const cached = cache.get<HourlyActivity[]>(cacheKey);
      if (cached) return cached;

      const result = await postgresManager.query(`
        SELECT 
          EXTRACT(HOUR FROM alert_timestamp) as hour,
          COUNT(*) as count,
          AVG(alert_price) as avg_price
        FROM alerts
        WHERE alert_timestamp >= NOW() - INTERVAL '30 days'
        GROUP BY EXTRACT(HOUR FROM alert_timestamp)
        ORDER BY hour ASC
      `);

      const data: HourlyActivity[] = result.rows.map((row: any) => ({
        hour: parseInt(row.hour),
        count: parseInt(row.count),
        avgPrice: row.avg_price ? parseFloat(row.avg_price) : 0,
      }));

      cache.set(cacheKey, data, 600); // 10 minutes
      return data;
    } catch (error) {
      console.error('Error fetching hourly activity:', error);
      throw error;
    }
  }

  /**
   * Get top tokens by alert count
   */
  async getTopTokens(limit: number = 10): Promise<TopToken[]> {
    try {
      const cacheKey = `analytics:top-tokens:${limit}`;
      const cached = cache.get<TopToken[]>(cacheKey);
      if (cached) return cached;

      const result = await postgresManager.query(
        `
        SELECT 
          t.symbol,
          t.address,
          t.chain,
          COUNT(a.id) as alert_count,
          COUNT(DISTINCT a.caller_id) as unique_callers
        FROM tokens t
        LEFT JOIN alerts a ON a.token_id = t.id
        GROUP BY t.id, t.symbol, t.address, t.chain
        HAVING COUNT(a.id) > 0
        ORDER BY alert_count DESC
        LIMIT $1
        `,
        [limit]
      );

      const data: TopToken[] = result.rows.map((row: any) => ({
        symbol: row.symbol || 'Unknown',
        address: row.address,
        chain: row.chain,
        alertCount: parseInt(row.alert_count),
        uniqueCallers: parseInt(row.unique_callers),
      }));

      cache.set(cacheKey, data, 600); // 10 minutes
      return data;
    } catch (error) {
      console.error('Error fetching top tokens:', error);
      throw error;
    }
  }

  /**
   * Get caller activity comparison (last 7 days vs previous 7 days)
   */
  async getCallerActivityComparison(callerName?: string): Promise<{
    current: TimeSeriesPoint[];
    previous: TimeSeriesPoint[];
  }> {
    try {
      const cacheKey = `analytics:caller-comparison:${callerName || 'all'}`;
      const cached = cache.get<any>(cacheKey);
      if (cached) return cached;

      const last7Days = subDays(new Date(), 7);
      const previous7Days = subDays(new Date(), 14);

      let whereClause = '';
      const params: any[] = [last7Days.toISOString(), previous7Days.toISOString()];
      
      if (callerName) {
        whereClause = ' AND c.handle = $3';
        params.push(callerName);
      }

      const result = await postgresManager.query(
        `
        SELECT 
          DATE(a.alert_timestamp) as date,
          COUNT(*) as count,
          CASE 
            WHEN a.alert_timestamp >= $1 THEN 'current'
            ELSE 'previous'
          END as period
        FROM alerts a
        LEFT JOIN callers c ON c.id = a.caller_id
        WHERE a.alert_timestamp >= $2${whereClause}
        GROUP BY DATE(a.alert_timestamp), period
        ORDER BY date ASC
        `,
        params
      );

      const current: TimeSeriesPoint[] = [];
      const previous: TimeSeriesPoint[] = [];

      result.rows.forEach((row: any) => {
        const point = {
          date: format(new Date(row.date), 'MMM dd'),
          count: parseInt(row.count),
        };

        if (row.period === 'current') {
          current.push(point);
        } else {
          previous.push(point);
        }
      });

      const data = { current, previous };
      cache.set(cacheKey, data, 300); // 5 minutes
      return data;
    } catch (error) {
      console.error('Error fetching caller activity comparison:', error);
      throw error;
    }
  }

  /**
   * Get price distribution (histogram data)
   */
  async getPriceDistribution(): Promise<{ range: string; count: number }[]> {
    try {
      const cacheKey = 'analytics:price-distribution';
      const cached = cache.get<any[]>(cacheKey);
      if (cached) return cached;

      const result = await postgresManager.query(`
        SELECT 
          CASE 
            WHEN alert_price < 0.000001 THEN '< $0.000001'
            WHEN alert_price < 0.00001 THEN '$0.000001 - $0.00001'
            WHEN alert_price < 0.0001 THEN '$0.00001 - $0.0001'
            WHEN alert_price < 0.001 THEN '$0.0001 - $0.001'
            WHEN alert_price < 0.01 THEN '$0.001 - $0.01'
            WHEN alert_price < 0.1 THEN '$0.01 - $0.1'
            WHEN alert_price < 1 THEN '$0.1 - $1'
            WHEN alert_price < 10 THEN '$1 - $10'
            ELSE '> $10'
          END as range,
          COUNT(*) as count
        FROM alerts
        WHERE alert_price IS NOT NULL
        GROUP BY range
        ORDER BY MIN(alert_price) ASC
      `);

      const data = result.rows.map((row: any) => ({
        range: row.range,
        count: parseInt(row.count),
      }));

      cache.set(cacheKey, data, 600); // 10 minutes
      return data;
    } catch (error) {
      console.error('Error fetching price distribution:', error);
      throw error;
    }
  }
}

export const analyticsService = new AnalyticsService();

