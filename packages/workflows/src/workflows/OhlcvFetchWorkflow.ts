/**
 * OHLCV Fetch Workflow
 * =====================
 * Reusable workflow for fetching OHLCV data with various filters and parameters
 */

import { ScriptExecutor, createQueryMiddleware, createProcessMiddleware, createStoreMiddleware } from '../middleware';
import { Pool } from 'pg';
import { fetchHybridCandles } from '@quantbot/simulation';
import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import type { Chain } from '@quantbot/core';

export interface OhlcvFetchConfig {
  // Query parameters
  queryType: 'alerts' | 'calls' | 'tokens' | 'custom';
  customQuery?: string;
  queryParams?: any[];
  
  // Time range
  from?: Date;
  to?: Date;
  preWindowMinutes?: number; // Minutes before alert/call time
  postWindowMinutes?: number; // Minutes after alert/call time
  
  // Filtering
  callerNames?: string[];
  chains?: Chain[];
  minAlertCount?: number;
  limit?: number;
  
  // OHLCV parameters
  interval?: '1m' | '5m' | '15m' | '1h';
  useCache?: boolean;
  
  // Rate limiting
  rateLimitMs?: number;
  
  // Database
  pgPool: Pool;
}

/**
 * Create OHLCV fetch workflow executor
 */
export function createOhlcvFetchWorkflow(config: OhlcvFetchConfig): ScriptExecutor {
  const executor = new ScriptExecutor({
    name: 'ohlcv-fetch',
    description: 'Fetch OHLCV candles for tokens/alerts/calls',
    rateLimitMs: config.rateLimitMs || 1000,
    continueOnError: true,
    progressInterval: 10,
  });

  // Build query based on queryType
  let query = '';
  let queryParams: any[] = [];

  if (config.queryType === 'alerts') {
    query = `
      SELECT DISTINCT 
        t.address,
        t.symbol,
        t.chain,
        MIN(a.alert_timestamp) as first_alert,
        MAX(a.alert_timestamp) as last_alert,
        COUNT(*) as alert_count
      FROM tokens t
      JOIN alerts a ON a.token_id = t.id
      WHERE a.alert_price IS NOT NULL
      AND a.alert_price > 0
      ${config.chains ? `AND t.chain = ANY($1)` : ''}
      ${config.from ? `AND a.alert_timestamp >= $${config.chains ? 2 : 1}` : ''}
      ${config.callerNames ? `AND c.handle = ANY($${config.chains ? (config.from ? 3 : 2) : (config.from ? 2 : 1)})` : ''}
      GROUP BY t.address, t.symbol, t.chain
      ${config.minAlertCount ? `HAVING COUNT(*) >= ${config.minAlertCount}` : ''}
      ORDER BY alert_count DESC
      ${config.limit ? `LIMIT ${config.limit}` : ''}
    `;
    // Build params array
    const params: any[] = [];
    if (config.chains) params.push(config.chains);
    if (config.from) params.push(config.from);
    if (config.callerNames) params.push(config.callerNames);
    queryParams = params;
  } else if (config.queryType === 'calls') {
    query = `
      SELECT DISTINCT
        t.address,
        t.symbol,
        t.chain,
        MIN(c.call_timestamp) as first_call,
        MAX(c.call_timestamp) as last_call,
        COUNT(*) as call_count
      FROM tokens t
      JOIN calls c ON c.token_id = t.id
      ${config.from ? `WHERE c.call_timestamp >= $1` : ''}
      ${config.callerNames ? `AND caller_name = ANY($${config.from ? 2 : 1})` : ''}
      GROUP BY t.address, t.symbol, t.chain
      ORDER BY call_count DESC
      ${config.limit ? `LIMIT ${config.limit}` : ''}
    `;
    if (config.from) queryParams.push(config.from);
    if (config.callerNames) queryParams.push(config.callerNames);
  } else if (config.queryType === 'custom' && config.customQuery) {
    query = config.customQuery;
    queryParams = config.queryParams || [];
  } else {
    throw new Error(`Invalid queryType: ${config.queryType}`);
  }

  // Query middleware
  executor.use(
    createQueryMiddleware({
      type: 'postgres',
      query,
      params: queryParams,
      pool: config.pgPool,
      transform: (row: any) => ({
        tokenAddress: row.address,
        tokenSymbol: row.symbol,
        chain: row.chain || 'solana',
        firstAlert: row.first_alert || row.first_call,
        lastAlert: row.last_alert || row.last_call,
        alertCount: row.alert_count || row.call_count,
      }),
    })
  );

  // Process middleware - Fetch OHLCV for each token
  executor.use(
    createProcessMiddleware({
      processor: async (item: any, index: number, total: number) => {
        const alertTime = DateTime.fromJSDate(new Date(item.firstAlert));
        const preWindow = config.preWindowMinutes || 260; // Default 52 * 5m periods
        const postWindow = config.postWindowMinutes || 1440; // Default 24 hours
        
        const startTime = alertTime.minus({ minutes: preWindow });
        const endTime = alertTime.plus({ minutes: postWindow });

        logger.debug(`Fetching OHLCV for ${item.tokenSymbol || item.tokenAddress.substring(0, 8)}`, {
          index: index + 1,
          total,
          startTime: startTime.toISO(),
          endTime: endTime.toISO(),
        });

        const candles = await fetchHybridCandles(
          item.tokenAddress,
          startTime,
          endTime,
          item.chain,
          alertTime
        );

        return {
          ...item,
          candles,
          candleCount: candles.length,
        };
      },
      rateLimitMs: config.rateLimitMs || 1000,
      continueOnError: true,
      progressInterval: 10,
    })
  );

  // Store middleware - Store candles to ClickHouse
  // Note: This requires ClickHouse client to be initialized
  executor.use(
    createStoreMiddleware({
      storer: async (item: any) => {
        if (!item.candles || item.candles.length === 0) {
          logger.debug(`No candles to store for ${item.tokenAddress.substring(0, 8)}`);
          return;
        }

        // Import storage functions dynamically to avoid circular dependencies
        const { insertCandles } = await import('@quantbot/storage');
        
        // Convert candles format if needed
        const candlesToStore = item.candles.map((c: any) => ({
          token_address: item.tokenAddress,
          chain: item.chain,
          timestamp: new Date(c.timestamp * 1000),
          interval: config.interval || '1m',
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }));

        await insertCandles(candlesToStore);
        logger.debug(`Stored ${item.candleCount} candles for ${item.tokenAddress.substring(0, 8)}`);
      },
      continueOnError: true,
    })
  );

  return executor;
}

