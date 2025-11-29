/**
 * Caller Alert Service
 * ===================
 * Business logic for caller alerts
 */

import { promisify } from 'util';
import { dbManager } from '../db-manager';
import { queryCandlesBatch } from '../clickhouse';
import { cache, cacheKeys } from '../cache';
import { simulateTenkanKijunRemainingPeriodOnly } from '../strategy';
import { calculateMarketCapsBatch } from '../market-cap';
import { strategyResultsDb } from '../jobs/strategy-results-db';
import { CallerAlert } from '../types/api';
import { CallerAlertRow, StrategyResultRow, DuplicateCheckResult, CountResult } from '../types/database';
import { PaginationMeta } from '../utils/pagination';

export interface CallerHistoryFilters {
  caller?: string;
  startDate?: string;
  endDate?: string;
  minMarketCap?: number;
  maxMarketCap?: number;
  minMaxGain?: number;
  maxMaxGain?: number;
  isDuplicate?: boolean;
}

export interface CallerHistoryResult {
  data: CallerAlert[];
  total: number;
  meta?: PaginationMeta;
}

export class CallerAlertService {
  /**
   * Get caller history with filters and pagination
   */
  async getCallerHistory(
    filters: CallerHistoryFilters,
    page: number = 1,
    pageSize: number = 50
  ): Promise<CallerHistoryResult> {
    const db = await dbManager.getDatabase();
    const all = promisify(db.all.bind(db)) as <T = any>(query: string, params?: any[]) => Promise<T[]>;
    const get = promisify(db.get.bind(db)) as <T = any>(query: string, params?: any[]) => Promise<T | undefined>;

    let query = 'SELECT * FROM caller_alerts WHERE 1=1';
    const params: (string | number)[] = [];

    if (filters.caller) {
      query += ' AND caller_name = ?';
      params.push(filters.caller);
    }

    if (filters.startDate) {
      query += ' AND alert_timestamp >= ?';
      params.push(filters.startDate);
    }

    if (filters.endDate) {
      query += ' AND alert_timestamp <= ?';
      params.push(filters.endDate);
    }

    // Get total count
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as count');
    const countResult = await get<CountResult>(countQuery, params);
    const total = countResult?.count || 0;

    // Add pagination
    query += ' ORDER BY alert_timestamp DESC LIMIT ? OFFSET ?';
    params.push(pageSize, (page - 1) * pageSize);

    const rows = await all<CallerAlertRow>(query, params);

    // Batch duplicate checks - optimized single query
    let duplicateMap: Map<number, boolean>;
    if (rows.length > 0) {
      const duplicateCheckQuery = `
        SELECT 
          ca1.id,
          COUNT(ca2.id) as duplicate_count
        FROM caller_alerts ca1
        LEFT JOIN caller_alerts ca2 ON 
          ca2.token_address = ca1.token_address 
          AND ca2.caller_name = ca1.caller_name
          AND ca2.alert_timestamp BETWEEN datetime(ca1.alert_timestamp, '-1 day') AND datetime(ca1.alert_timestamp, '+1 day')
          AND ca2.id != ca1.id
        WHERE ca1.id IN (${rows.map(() => '?').join(',')})
        GROUP BY ca1.id
      `;
      const duplicateResults = await all<DuplicateCheckResult>(duplicateCheckQuery, rows.map(r => r.id));
      duplicateMap = new Map(duplicateResults.map(d => [d.id, (d.duplicate_count || 0) > 0]));
    } else {
      duplicateMap = new Map<number, boolean>();
    }

    // Batch OHLCV queries
    const ohlcvQueries = rows.map((row) => {
      const alertTime = new Date(row.alert_timestamp);
      const endTime = new Date(alertTime.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
      return {
        tokenAddress: row.token_address,
        chain: row.chain || 'solana',
        startTime: alertTime,
        endTime: endTime,
        interval: '5m',
        rowId: row.id,
      };
    });

    // Check cache first, then batch query
    const ohlcvResults = new Map<number, Array<{ timestamp: string; open: string; high: string; low: string; close: string; volume: string }>>();
    const uncachedQueries: typeof ohlcvQueries = [];

    for (const q of ohlcvQueries) {
      const cacheKey = cacheKeys.ohlcv(
        q.tokenAddress,
        q.chain,
        q.startTime.toISOString(),
        q.endTime.toISOString(),
        q.interval
      );
      const cached = cache.get<Array<{ timestamp: string; open: string; high: string; low: string; close: string; volume: string }>>(cacheKey);
      if (cached) {
        ohlcvResults.set(q.rowId, cached);
      } else {
        uncachedQueries.push(q);
      }
    }

    // Batch query uncached items
    if (uncachedQueries.length > 0) {
      const batchResults = await queryCandlesBatch(
        uncachedQueries.map(q => ({
          tokenAddress: q.tokenAddress,
          chain: q.chain,
          startTime: q.startTime,
          endTime: q.endTime,
          interval: q.interval,
        }))
      );

      // Store in cache and map
      for (let i = 0; i < uncachedQueries.length; i++) {
        const q = uncachedQueries[i];
        const result = (Array.isArray(batchResults) ? batchResults[i] : []) || [];
        const cacheKey = cacheKeys.ohlcv(
          q.tokenAddress,
          q.chain,
          q.startTime.toISOString(),
          q.endTime.toISOString(),
          q.interval
        );
        cache.set(cacheKey, result, 3600); // 1 hour cache
        ohlcvResults.set(q.rowId, result);
      }
    }

    // Get strategy results from database - batch query
    let strategyMap = new Map<number, StrategyResultRow | null>();
    if (rows.length > 0) {
      try {
        const strategyDb = await strategyResultsDb.getDatabase();
        const strategyAll = promisify(strategyDb.all.bind(strategyDb)) as <T = any>(query: string, params?: any[]) => Promise<T[]>;
        
        // Build batch query with IN clause
        const placeholders = rows.map(() => '(?, ?, ?)').join(', ');
        const batchParams: (string | number)[] = rows.flatMap(row => [
          row.token_address,
          row.caller_name,
          row.alert_timestamp,
        ]);
        
        const batchQuery = `
          SELECT * FROM strategy_results 
          WHERE (token_address, caller_name, alert_timestamp) IN (${placeholders})
        `;
        
        const batchResults = await strategyAll<StrategyResultRow>(batchQuery, batchParams);
        
        // Create lookup map
        const lookupMap = new Map<string, StrategyResultRow>();
        for (const result of batchResults) {
          const key = `${result.token_address}:${result.caller_name}:${result.alert_timestamp}`;
          lookupMap.set(key, result);
        }
        
        // Map results to row IDs
        for (const row of rows) {
          const key = `${row.token_address}:${row.caller_name}:${row.alert_timestamp}`;
          const strategyResult = lookupMap.get(key) || null;
          strategyMap.set(row.id, strategyResult);
        }
      } catch (error) {
        // If batch query fails, fall back to individual queries
        const strategyDb = await strategyResultsDb.getDatabase();
        const strategyAll = promisify(strategyDb.all.bind(strategyDb)) as <T = any>(query: string, params?: any[]) => Promise<T[]>;
        
        const strategyResults = await Promise.all(
          rows.map(async (row) => {
            try {
              const results = await strategyAll<StrategyResultRow>(
                `SELECT * FROM strategy_results 
                 WHERE token_address = ? 
                 AND caller_name = ?
                 AND alert_timestamp = ?`,
                [row.token_address, row.caller_name, row.alert_timestamp]
              );
              return {
                id: row.id,
                strategyResult: results[0] || null,
              };
            } catch {
              return {
                id: row.id,
                strategyResult: null,
              };
            }
          })
        );
        strategyMap = new Map(strategyResults.map(s => [s.id, s.strategyResult]));
      }
    }

    // Calculate market caps
    const marketCapQueries = rows.map(row => ({
      tokenAddress: row.token_address,
      chain: row.chain || 'solana',
      price: parseFloat(row.price_at_alert || '0'),
      timestamp: row.alert_timestamp,
      rowId: row.id,
    }));

    const marketCaps = await calculateMarketCapsBatch(
      marketCapQueries.map(q => ({
        tokenAddress: q.tokenAddress,
        chain: q.chain,
        price: q.price,
        timestamp: q.timestamp,
      }))
    );
    
    // Convert Map<string, number | null> to Map<number, number | null>
    const marketCapMap = new Map<number, number | null>();
    for (const q of marketCapQueries) {
      const key = `${q.chain}:${q.tokenAddress}:${q.timestamp || 'current'}`;
      const mcap = marketCaps.get(key) ?? null;
      marketCapMap.set(q.rowId, mcap);
    }

    // Enrich rows with calculated data
    const enrichedRows: CallerAlert[] = rows.map((row) => {
      const ohlcv = ohlcvResults.get(row.id) || [];
      const strategyResult = strategyMap.get(row.id);
      const marketCap = marketCapMap.get(row.id);

      let maxPrice = row.max_price;
      let maxGainPercent = row.max_gain_percent;
      let timeToATH = row.time_to_ath;

      // If we have OHLCV data but no stored max price, calculate it
      if (ohlcv.length > 0 && !maxPrice) {
        const prices = ohlcv.map((candle) => parseFloat(candle.high || candle.close || '0'));
        maxPrice = Math.max(...prices);
        const alertPrice = parseFloat(row.price_at_alert || '0');
        if (alertPrice > 0) {
          maxGainPercent = ((maxPrice - alertPrice) / alertPrice) * 100;
        }
      }

      // Use strategy result if available
      if (strategyResult) {
        maxPrice = strategyResult.max_price || maxPrice;
        maxGainPercent = strategyResult.max_gain_percent || maxGainPercent;
        timeToATH = strategyResult.time_to_ath || timeToATH;
      }

      return {
        id: row.id,
        callerName: row.caller_name,
        tokenAddress: row.token_address,
        tokenSymbol: row.token_symbol || undefined,
        chain: row.chain,
        alertTimestamp: row.alert_timestamp,
        priceAtAlert: row.price_at_alert ? parseFloat(row.price_at_alert) : undefined,
        entryPrice: row.entry_price ? parseFloat(row.entry_price) : undefined,
        marketCapAtCall: marketCap !== null && marketCap !== undefined ? marketCap : undefined,
        maxPrice: maxPrice !== null && maxPrice !== undefined ? maxPrice : undefined,
        maxGainPercent: maxGainPercent !== null && maxGainPercent !== undefined ? maxGainPercent : undefined,
        timeToATH: timeToATH !== null && timeToATH !== undefined ? timeToATH : undefined,
        isDuplicate: duplicateMap.get(row.id) || false,
      };
    });

    // Apply filters that require calculation
    let filteredRows = enrichedRows;
    
    if (filters.minMarketCap !== undefined || filters.maxMarketCap !== undefined) {
      filteredRows = filteredRows.filter(row => {
        const mcap = row.marketCapAtCall;
        if (mcap === undefined) return false;
        if (filters.minMarketCap !== undefined && mcap < filters.minMarketCap) return false;
        if (filters.maxMarketCap !== undefined && mcap > filters.maxMarketCap) return false;
        return true;
      });
    }

    if (filters.minMaxGain !== undefined || filters.maxMaxGain !== undefined) {
      filteredRows = filteredRows.filter(row => {
        const gain = row.maxGainPercent;
        if (gain === undefined) return false;
        if (filters.minMaxGain !== undefined && gain < filters.minMaxGain) return false;
        if (filters.maxMaxGain !== undefined && gain > filters.maxMaxGain) return false;
        return true;
      });
    }

    if (filters.isDuplicate !== undefined) {
      filteredRows = filteredRows.filter(row => row.isDuplicate === filters.isDuplicate);
    }

    const meta: PaginationMeta = {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      hasNext: page < Math.ceil(total / pageSize),
      hasPrev: page > 1,
    };

    return {
      data: filteredRows,
      total,
      meta,
    };
  }

  /**
   * Get list of distinct callers
   */
  async getCallers(): Promise<string[]> {
    const CALLERS_CACHE_KEY = 'callers:list';
    
    // Check cache first
    const cached = cache.get<string[]>(CALLERS_CACHE_KEY);
    if (cached) {
      return cached;
    }

    const db = await dbManager.getDatabase();
    const all = promisify(db.all.bind(db)) as <T = any>(query: string, params?: any[]) => Promise<T[]>;

    const rows = await all<{ caller_name: string }>(
      `SELECT DISTINCT caller_name FROM caller_alerts ORDER BY caller_name`
    );

    const callers = rows.map((row) => row.caller_name);

    // Cache for 1 hour
    cache.set(CALLERS_CACHE_KEY, callers, 3600);

    return callers;
  }
}

export const callerAlertService = new CallerAlertService();

