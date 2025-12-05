/**
 * Caller Service - PostgreSQL Version
 * Replaces SQLite-based caller data access
 */

import { postgresManager } from '../db/postgres-manager';
import { cache, cacheKeys } from '../cache';
import { CONSTANTS } from '../constants';

export interface CallerAlert {
  id: number;
  token_address: string;
  token_symbol?: string;
  chain: string;
  caller_handle: string;
  alert_timestamp: Date;
  alert_price?: number;
  alert_message?: string;
}

export interface CallerStats {
  caller_handle: string;
  total_alerts: number;
  unique_tokens: number;
  first_alert: Date;
  last_alert: Date;
}

export class CallerService {
  /**
   * Get caller history with pagination and filtering
   */
  async getCallerHistory(options: {
    limit?: number;
    offset?: number;
    caller?: string;
    search?: string;
  } = {}): Promise<{ alerts: CallerAlert[]; total: number }> {
    const { limit = 50, offset = 0, caller, search } = options;

    try {
      // Build query
      let countQuery = `
        SELECT COUNT(*) as total
        FROM alerts a
        LEFT JOIN tokens t ON t.id = a.token_id
        LEFT JOIN callers c ON c.id = a.caller_id
        WHERE 1=1
      `;

      let dataQuery = `
        SELECT 
          a.id,
          t.address as token_address,
          t.symbol as token_symbol,
          t.chain,
          c.handle as caller_handle,
          a.alert_timestamp,
          a.alert_price,
          (a.raw_payload_json->>'message') as alert_message
        FROM alerts a
        LEFT JOIN tokens t ON t.id = a.token_id
        LEFT JOIN callers c ON c.id = a.caller_id
        WHERE 1=1
      `;

      const params: any[] = [];
      let paramIndex = 1;

      if (caller) {
        countQuery += ` AND c.handle = $${paramIndex}`;
        dataQuery += ` AND c.handle = $${paramIndex}`;
        params.push(caller);
        paramIndex++;
      }

      if (search) {
        countQuery += ` AND (t.symbol ILIKE $${paramIndex} OR t.address ILIKE $${paramIndex} OR c.handle ILIKE $${paramIndex})`;
        dataQuery += ` AND (t.symbol ILIKE $${paramIndex} OR t.address ILIKE $${paramIndex} OR c.handle ILIKE $${paramIndex})`;
        params.push(`%${search}%`);
        paramIndex++;
      }

      dataQuery += ` ORDER BY a.alert_timestamp DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit, offset);

      // Execute queries
      const [countResult, dataResult] = await Promise.all([
        postgresManager.query(countQuery, params.slice(0, -2)),
        postgresManager.query(dataQuery, params),
      ]);

      const alerts: CallerAlert[] = dataResult.rows.map((row: any) => ({
        id: row.id,
        token_address: row.token_address,
        token_symbol: row.token_symbol,
        chain: row.chain,
        caller_handle: row.caller_handle,
        alert_timestamp: new Date(row.alert_timestamp),
        alert_price: row.alert_price ? parseFloat(row.alert_price) : undefined,
        alert_message: row.alert_message,
      }));

      return {
        alerts,
        total: parseInt(countResult.rows[0].total),
      };
    } catch (error) {
      console.error('Error fetching caller history:', error);
      throw error;
    }
  }

  /**
   * Get recent alerts (past week)
   */
  async getRecentAlerts(limit: number = 100): Promise<any[]> {
    try {
      const cacheKey = cacheKeys.recentAlerts();
      const cached = cache.get<any[]>(cacheKey);
      if (cached) {
        return cached;
      }

      const result = await postgresManager.query(
        `
        SELECT 
          a.id,
          t.address as token_address,
          t.symbol as token_symbol,
          t.chain,
          c.handle as caller_handle,
          a.alert_timestamp,
          a.alert_price,
          a.side,
          a.confidence,
          (a.raw_payload_json->>'message') as alert_message
        FROM alerts a
        LEFT JOIN tokens t ON t.id = a.token_id
        LEFT JOIN callers c ON c.id = a.caller_id
        ORDER BY a.alert_timestamp DESC
        LIMIT $1
        `,
        [limit]
      );

      const alerts = result.rows.map((row: any) => ({
        id: row.id,
        tokenAddress: row.token_address,
        tokenSymbol: row.token_symbol,
        chain: row.chain,
        callerName: row.caller_handle,
        alertTimestamp: row.alert_timestamp,
        priceAtAlert: row.alert_price ? parseFloat(row.alert_price) : undefined,
        side: row.side,
        confidence: row.confidence ? parseFloat(row.confidence) : undefined,
        message: row.alert_message,
      }));

      cache.set(cacheKey, alerts, CONSTANTS.CACHE_TTL.RECENT_ALERTS || 300);
      return alerts;
    } catch (error) {
      console.error('Error fetching recent alerts:', error);
      throw error;
    }
  }

  /**
   * Get caller statistics
   */
  async getCallerStats(): Promise<CallerStats[]> {
    try {
      const cacheKey = cacheKeys.callerStats();
      const cached = cache.get<CallerStats[]>(cacheKey);
      if (cached) {
        return cached;
      }

      const result = await postgresManager.query(`
        SELECT 
          c.handle as caller_handle,
          COUNT(*) as total_alerts,
          COUNT(DISTINCT a.token_id) as unique_tokens,
          MIN(a.alert_timestamp) as first_alert,
          MAX(a.alert_timestamp) as last_alert
        FROM alerts a
        LEFT JOIN callers c ON c.id = a.caller_id
        GROUP BY c.handle
        ORDER BY total_alerts DESC
      `);

      const stats: CallerStats[] = result.rows.map((row: any) => ({
        caller_handle: row.caller_handle,
        total_alerts: parseInt(row.total_alerts),
        unique_tokens: parseInt(row.unique_tokens),
        first_alert: new Date(row.first_alert),
        last_alert: new Date(row.last_alert),
      }));

      cache.set(cacheKey, stats, CONSTANTS.CACHE_TTL.CALLER_STATS);
      return stats;
    } catch (error) {
      console.error('Error fetching caller stats:', error);
      throw error;
    }
  }

  /**
   * Get all unique callers
   */
  async getAllCallers(): Promise<string[]> {
    try {
      const result = await postgresManager.query(`
        SELECT DISTINCT handle
        FROM callers
        ORDER BY handle
      `);

      return result.rows.map((row: any) => row.handle);
    } catch (error) {
      console.error('Error fetching callers:', error);
      throw error;
    }
  }
}

export const callerService = new CallerService();

