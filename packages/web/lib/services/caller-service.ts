/**
 * Caller Service - PostgreSQL Version
 * Unified caller data access with pagination, filtering, and statistics
 */

import { postgresManager } from '../db/postgres-manager';
import { cache, cacheKeys } from '../cache';
import { CONSTANTS } from '../constants';
import { CallerHistoryRow, CallerStatsData, CallerStat, RecentAlertRow } from '../types';

export interface CallerHistoryFilters {
  caller?: string;
  startDate?: string;
  endDate?: string;
  minMarketCap?: number;
  maxMarketCap?: number;
  minMaxGain?: number;
  maxMaxGain?: number;
  isDuplicate?: boolean;
  search?: string;
}

export interface CallerHistoryResult {
  data: CallerHistoryRow[];
  total: number;
}

export interface RecentAlertsResult {
  data: RecentAlertRow[];
  total: number;
}

export class CallerService {
  /**
   * Get caller history with pagination and filtering
   * Returns data formatted for the frontend CallerHistoryRow interface
   */
  async getCallerHistory(
    filters: CallerHistoryFilters = {},
    page: number = 1,
    pageSize: number = 50
  ): Promise<CallerHistoryResult> {
    // Validate inputs
    if (page < 1) page = 1;
    if (pageSize < 1) pageSize = 50;
    if (pageSize > CONSTANTS.REQUEST.MAX_PAGE_SIZE) pageSize = CONSTANTS.REQUEST.MAX_PAGE_SIZE;

    const { caller, startDate, endDate, search } = filters;
    const offset = (page - 1) * pageSize;

    try {
      // Build dynamic WHERE clause
      const conditions: string[] = ['1=1'];
      const params: any[] = [];
      let paramIndex = 1;

      if (caller) {
        conditions.push(`c.handle = $${paramIndex}`);
        params.push(caller);
        paramIndex++;
      }

      if (startDate) {
        conditions.push(`a.alert_timestamp >= $${paramIndex}::timestamptz`);
        params.push(startDate);
        paramIndex++;
      }

      if (endDate) {
        conditions.push(`a.alert_timestamp <= $${paramIndex}::timestamptz`);
        params.push(endDate);
        paramIndex++;
      }

      if (search) {
        conditions.push(`(t.symbol ILIKE $${paramIndex} OR t.address ILIKE $${paramIndex} OR c.handle ILIKE $${paramIndex})`);
        params.push(`%${search}%`);
        paramIndex++;
      }

      const whereClause = conditions.join(' AND ');

      // Count query
      const countQuery = `
        SELECT COUNT(*) as total
        FROM alerts a
        LEFT JOIN tokens t ON t.id = a.token_id
        LEFT JOIN callers c ON c.id = a.caller_id
        WHERE ${whereClause}
      `;

      // Data query with all needed fields
      const dataQuery = `
        SELECT 
          a.id,
          c.handle as caller_name,
          t.address as token_address,
          t.symbol as token_symbol,
          t.chain,
          a.alert_timestamp,
          a.alert_price as price_at_alert,
          a.alert_price as entry_price,
          (a.raw_payload_json->>'message') as alert_message,
          -- Check for duplicates (same token within 24 hours by same caller)
          EXISTS(
            SELECT 1 FROM alerts a2
            LEFT JOIN callers c2 ON c2.id = a2.caller_id
            WHERE a2.token_id = a.token_id 
              AND c2.handle = c.handle
              AND a2.id != a.id
              AND a2.alert_timestamp BETWEEN a.alert_timestamp - INTERVAL '24 hours' 
                                         AND a.alert_timestamp + INTERVAL '24 hours'
          ) as is_duplicate
        FROM alerts a
        LEFT JOIN tokens t ON t.id = a.token_id
        LEFT JOIN callers c ON c.id = a.caller_id
        WHERE ${whereClause}
        ORDER BY a.alert_timestamp DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;

      const countParams = params.slice();
      params.push(pageSize, offset);

      // Execute queries
      const [countResult, dataResult] = await Promise.all([
        postgresManager.query(countQuery, countParams),
        postgresManager.query(dataQuery, params),
      ]);

      const total = parseInt(countResult.rows[0]?.total || '0');

      // Format data for frontend
      let data: CallerHistoryRow[] = dataResult.rows.map((row: any) => ({
        id: row.id,
        callerName: row.caller_name || 'Unknown',
        tokenAddress: row.token_address || '',
        tokenSymbol: row.token_symbol || undefined,
        chain: row.chain || 'solana',
        alertTimestamp: row.alert_timestamp ? new Date(row.alert_timestamp).toISOString() : '',
        priceAtAlert: row.price_at_alert ? parseFloat(row.price_at_alert) : undefined,
        entryPrice: row.entry_price ? parseFloat(row.entry_price) : undefined,
        marketCapAtCall: undefined, // Calculated separately if needed
        maxPrice: undefined, // Calculated separately from OHLCV
        maxGainPercent: undefined, // Calculated separately
        timeToATH: null,
        isDuplicate: row.is_duplicate || false,
      }));

      // Apply post-query filters for calculated fields
      // Note: When filtering by isDuplicate, we need to recalculate total
      let filteredData = data;
      let adjustedTotal = total;
      
      if (filters.isDuplicate !== undefined) {
        filteredData = filteredData.filter(row => row.isDuplicate === filters.isDuplicate);
        // If we filtered, we need to get the actual count
        // For now, we'll use the filtered length as approximation
        // In production, you might want to do a separate count query with the filter
        if (filteredData.length !== data.length) {
          // If filtering changed results, we need to adjust total
          // This is an approximation - for exact count, would need another query
          adjustedTotal = filteredData.length;
        }
      }

      return {
        data: filteredData,
        total: adjustedTotal,
      };
    } catch (error) {
      console.error('Error fetching caller history:', error);
      throw error;
    }
  }

  /**
   * Get recent alerts (configurable time range, default past week)
   * Returns data formatted for the frontend RecentAlertRow interface
   */
  async getRecentAlerts(
    page: number = 1,
    pageSize: number = 100,
    daysBack: number = 7
  ): Promise<RecentAlertsResult> {
    // Validate inputs
    if (page < 1) page = 1;
    if (pageSize < 1) pageSize = 100;
    if (pageSize > CONSTANTS.REQUEST.MAX_PAGE_SIZE) pageSize = CONSTANTS.REQUEST.MAX_PAGE_SIZE;
    if (daysBack < 1) daysBack = 7;
    if (daysBack > 365) daysBack = 365; // Cap at 1 year

    const offset = (page - 1) * pageSize;
    const cacheKey = `recent-alerts:${page}:${pageSize}:${daysBack}`;

    try {
      const cached = cache.get<RecentAlertsResult>(cacheKey);
      if (cached) {
        return cached;
      }

      // Use parameterized query to prevent SQL injection
      // Count query
      const countQuery = `
        SELECT COUNT(*) as total
        FROM alerts a
        WHERE a.alert_timestamp >= NOW() - INTERVAL '1 day' * $1
      `;

      // Data query
      const dataQuery = `
        SELECT 
          a.id,
          c.handle as caller_name,
          t.address as token_address,
          t.symbol as token_symbol,
          t.chain,
          a.alert_timestamp,
          a.alert_price as price_at_alert,
          a.alert_price as entry_price,
          a.side,
          a.confidence,
          (a.raw_payload_json->>'message') as alert_message,
          -- Check for duplicates
          EXISTS(
            SELECT 1 FROM alerts a2
            LEFT JOIN callers c2 ON c2.id = a2.caller_id
            WHERE a2.token_id = a.token_id 
              AND c2.handle = c.handle
              AND a2.id != a.id
              AND a2.alert_timestamp BETWEEN a.alert_timestamp - INTERVAL '24 hours' 
                                         AND a.alert_timestamp + INTERVAL '24 hours'
          ) as is_duplicate
        FROM alerts a
        LEFT JOIN tokens t ON t.id = a.token_id
        LEFT JOIN callers c ON c.id = a.caller_id
        WHERE a.alert_timestamp >= NOW() - INTERVAL '1 day' * $1
        ORDER BY a.alert_timestamp DESC
        LIMIT $2 OFFSET $3
      `;

      const [countResult, dataResult] = await Promise.all([
        postgresManager.query(countQuery, [daysBack]),
        postgresManager.query(dataQuery, [daysBack, pageSize, offset]),
      ]);

      const total = parseInt(countResult.rows[0]?.total || '0');

      // Format data for frontend
      const data: RecentAlertRow[] = dataResult.rows.map((row: any) => ({
        id: row.id,
        callerName: row.caller_name || 'Unknown',
        tokenAddress: row.token_address || '',
        tokenSymbol: row.token_symbol || undefined,
        chain: row.chain || 'solana',
        alertTimestamp: row.alert_timestamp ? new Date(row.alert_timestamp).toISOString() : '',
        priceAtAlert: row.price_at_alert ? parseFloat(row.price_at_alert) : undefined,
        entryPrice: row.entry_price ? parseFloat(row.entry_price) : undefined,
        marketCapAtCall: undefined,
        maxPrice: undefined,
        maxGainPercent: undefined,
        timeToATH: null,
        isDuplicate: row.is_duplicate || false,
        currentPrice: undefined, // Can be enriched with live price data
        currentGainPercent: undefined,
      }));

      const result = { data, total };
      cache.set(cacheKey, result, CONSTANTS.CACHE_TTL.RECENT_ALERTS || 300);
      return result;
    } catch (error) {
      console.error('Error fetching recent alerts:', error);
      throw error;
    }
  }

  /**
   * Get caller statistics formatted for the frontend CallerStatsData interface
   */
  async getCallerStatsFormatted(): Promise<CallerStatsData> {
    try {
      const cacheKey = 'caller-stats-formatted';
      const cached = cache.get<CallerStatsData>(cacheKey);
      if (cached) {
        return cached;
      }

      // Query for individual caller stats
      const callerQuery = `
        SELECT 
          c.handle as name,
          COUNT(*) as total_calls,
          COUNT(DISTINCT a.token_id) as unique_tokens,
          MIN(a.alert_timestamp) as first_call,
          MAX(a.alert_timestamp) as last_call,
          AVG(a.alert_price) as avg_price
        FROM alerts a
        LEFT JOIN callers c ON c.id = a.caller_id
        WHERE c.handle IS NOT NULL
        GROUP BY c.handle
        ORDER BY total_calls DESC
      `;

      // Query for overall totals
      const totalsQuery = `
        SELECT 
          COUNT(*) as total_calls,
          COUNT(DISTINCT a.caller_id) as total_callers,
          COUNT(DISTINCT a.token_id) as total_tokens,
          MIN(a.alert_timestamp) as earliest_call,
          MAX(a.alert_timestamp) as latest_call
        FROM alerts a
      `;

      const [callerResult, totalsResult] = await Promise.all([
        postgresManager.query(callerQuery),
        postgresManager.query(totalsQuery),
      ]);

      const callers: CallerStat[] = callerResult.rows.map((row: any) => ({
        name: row.name || 'Unknown',
        totalCalls: parseInt(row.total_calls || '0'),
        uniqueTokens: parseInt(row.unique_tokens || '0'),
        firstCall: row.first_call ? new Date(row.first_call).toISOString() : '',
        lastCall: row.last_call ? new Date(row.last_call).toISOString() : '',
        avgPrice: row.avg_price ? parseFloat(row.avg_price) : null,
        avgMarketCap: null, // Calculated separately if needed
      }));

      const totalsRow = totalsResult.rows[0] || {};
      const result: CallerStatsData = {
        callers,
        totals: {
          total_calls: parseInt(totalsRow.total_calls || '0'),
          total_callers: parseInt(totalsRow.total_callers || '0'),
          total_tokens: parseInt(totalsRow.total_tokens || '0'),
          earliest_call: totalsRow.earliest_call ? new Date(totalsRow.earliest_call).toISOString() : null,
          latest_call: totalsRow.latest_call ? new Date(totalsRow.latest_call).toISOString() : null,
        },
      };

      cache.set(cacheKey, result, CONSTANTS.CACHE_TTL.CALLER_STATS);
      return result;
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
      const cacheKey = 'all-callers-list';
      const cached = cache.get<string[]>(cacheKey);
      if (cached) {
        return cached;
      }

      const result = await postgresManager.query(`
        SELECT DISTINCT handle
        FROM callers
        WHERE handle IS NOT NULL
        ORDER BY handle
      `);

      const callers = result.rows.map((row: any) => row.handle);
      cache.set(cacheKey, callers, CONSTANTS.CACHE_TTL.CALLER_STATS);
      return callers;
    } catch (error) {
      console.error('Error fetching callers:', error);
      throw error;
    }
  }
}

export const callerService = new CallerService();

