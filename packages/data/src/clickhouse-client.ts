/**
 * ClickHouse Client for OHLCV Data Storage
 * 
 * Provides fast, efficient storage and retrieval of OHLCV candle data
 * using ClickHouse columnar database for time-series data.
 */

import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import type { Candle } from '@quantbot/core';

// ClickHouse connection configuration
const CLICKHOUSE_HOST = process.env.CLICKHOUSE_HOST || 'localhost';
const CLICKHOUSE_PORT = process.env.CLICKHOUSE_PORT ? parseInt(process.env.CLICKHOUSE_PORT) : 8123;
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER || 'default';
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD || '';
const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

// Singleton client instance
let client: ClickHouseClient | null = null;

export interface TickEvent {
  timestamp: number; // unix seconds
  price: number;
  size?: number;
  signature?: string;
  slot?: number;
  source?: 'ws' | 'backfill' | 'rpc';
}

/**
 * Get or create ClickHouse client instance
 */
export function getClickHouseClient(): ClickHouseClient {
  // Reuse existing client - don't recreate on every call (this was causing socket hang ups)
  if (client) {
    return client;
  }
  
  // Create new client only if it doesn't exist
  const url = `http://${CLICKHOUSE_HOST}:${CLICKHOUSE_PORT}`;
  const config: any = {
    url: url,
    username: CLICKHOUSE_USER,
    database: CLICKHOUSE_DATABASE,
    // Connection settings to prevent socket hang ups
    request_timeout: 60000, // 60 seconds
    max_open_connections: 10, // Limit concurrent connections
  };
  // Use password only if explicitly set and not empty
  // Default ClickHouse user often has no password
  const password = process.env.CLICKHOUSE_PASSWORD;
  if (password && password.trim() !== '') {
    config.password = password;
  }
  
  client = createClient(config);
  return client;
}

/**
 * Initialize ClickHouse database and create tables
 */
export async function initClickHouse(): Promise<void> {
  const url = `http://${CLICKHOUSE_HOST}:${CLICKHOUSE_PORT}`;
  const tempConfig: any = {
    url,
    username: CLICKHOUSE_USER,
  };

  if (CLICKHOUSE_PASSWORD !== undefined && CLICKHOUSE_PASSWORD !== '') {
    tempConfig.password = CLICKHOUSE_PASSWORD;
  }

  const tempClient = createClient(tempConfig);

  try {
    await tempClient.exec({
      query: `CREATE DATABASE IF NOT EXISTS ${CLICKHOUSE_DATABASE}`,
    });

    await tempClient.close();

    const ch = getClickHouseClient();
    await ensureOhlcvTable(ch);
    await ensureTickTable(ch);
    await ensureSimulationTables(ch);

    logger.info('ClickHouse database and tables initialized');
  } catch (error: any) {
    logger.error('Error initializing ClickHouse', error as Error);
    await tempClient.close().catch(() => {});
    throw error;
  }
}

async function ensureOhlcvTable(ch: ClickHouseClient): Promise<void> {
  await ch.exec({
    query: `
      CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.ohlcv_candles (
        token_address String,
        chain String,
        timestamp DateTime,
        interval String,
        open Float64,
        high Float64,
        low Float64,
        close Float64,
        volume Float64
      )
      ENGINE = MergeTree()
      PARTITION BY (chain, toYYYYMM(timestamp))
      ORDER BY (token_address, chain, timestamp)
      SETTINGS index_granularity = 8192
    `,
  });
}

async function ensureTickTable(ch: ClickHouseClient): Promise<void> {
  await ch.exec({
    query: `
      CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.tick_events (
        token_address String,
        chain String,
        timestamp DateTime,
        price Float64,
        size Float64,
        signature String,
        slot UInt64,
        source String
      )
      ENGINE = MergeTree()
      PARTITION BY (chain, toYYYYMM(timestamp))
      ORDER BY (token_address, timestamp, signature)
      SETTINGS index_granularity = 8192
    `,
  });
}

async function ensureSimulationTables(ch: ClickHouseClient): Promise<void> {
  await ch.exec({
    query: `
      CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.simulation_events (
        simulation_run_id UInt64,
        token_address String,
        chain String,
        event_time DateTime,
        seq UInt32,
        event_type String,
        price Float64,
        size Float64,
        remaining_position Float64,
        pnl_so_far Float64,
        indicators_json String,
        position_state_json String,
        metadata_json String
      )
      ENGINE = MergeTree()
      PARTITION BY (chain, toYYYYMM(event_time))
      ORDER BY (simulation_run_id, seq)
      SETTINGS index_granularity = 8192
    `,
  });

  await ch.exec({
    query: `
      CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.simulation_aggregates (
        simulation_run_id UInt64,
        token_address String,
        chain String,
        final_pnl Float64,
        max_drawdown Float64,
        volatility Float64,
        sharpe_ratio Float64,
        sortino_ratio Float64,
        win_rate Float64,
        trade_count UInt32,
        reentry_count UInt32,
        ladder_entries_used UInt32,
        ladder_exits_used UInt32,
        created_at DateTime DEFAULT now()
      )
      ENGINE = MergeTree()
      PARTITION BY (chain, toYYYYMM(created_at))
      ORDER BY (simulation_run_id)
      SETTINGS index_granularity = 8192
    `,
  });
}

/**
 * Insert candles into ClickHouse
 */
export async function insertCandles(
  tokenAddress: string,
  chain: string,
  candles: Candle[],
  interval: string = '5m',
  isBackfill: boolean = false
): Promise<void> {
  if (candles.length === 0) return;
  
  const ch = getClickHouseClient();
  
  const rows = candles.map(candle => ({
    token_address: tokenAddress,
    chain: chain,
    timestamp: DateTime.fromSeconds(candle.timestamp).toFormat('yyyy-MM-dd HH:mm:ss'), // Convert to ClickHouse DateTime format
    interval: interval,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    // Note: is_backfill column removed - table doesn't have this column
    // is_backfill: isBackfill ? 1 : 0,
  }));
  
  try {
    await ch.insert({
      table: `${CLICKHOUSE_DATABASE}.ohlcv_candles`,
      values: rows,
      format: 'JSONEachRow',
    });
  } catch (error: any) {
    // Silently fail if USE_CACHE_ONLY is set (insertions not needed in cache-only mode)
    if (process.env.USE_CACHE_ONLY !== 'true') {
      const displayAddr = tokenAddress.length > 30 ? tokenAddress.substring(0, 30) + '...' : tokenAddress;
      logger.error('Error inserting candles', error as Error, { tokenAddress: displayAddr });
    }
    // Don't throw in cache-only mode - just skip insertion
    if (process.env.USE_CACHE_ONLY === 'true') {
      return;
    }
    throw error;
  }
}

/**
 * Insert raw ticks into ClickHouse for high-resolution replay.
 */
export async function insertTicks(
  tokenAddress: string,
  chain: string,
  ticks: TickEvent[]
): Promise<void> {
  if (ticks.length === 0) return;

  const ch = getClickHouseClient();
  const values = ticks.map(tick => ({
    token_address: tokenAddress,
    chain,
    timestamp: DateTime.fromSeconds(tick.timestamp).toFormat('yyyy-MM-dd HH:mm:ss'),
    price: tick.price,
    size: tick.size ?? 0,
    signature: tick.signature ?? '',
    slot: tick.slot ?? 0,
    source: tick.source ?? 'ws',
  }));

  try {
    await ch.insert({
      table: `${CLICKHOUSE_DATABASE}.tick_events`,
      values,
      format: 'JSONEachRow',
    });
  } catch (error: any) {
    logger.error('Error inserting ticks', error as Error, { tokenAddress: tokenAddress.substring(0, 20) });
    throw error;
  }
}

/**
 * Query candles from ClickHouse
 */
export async function queryCandles(
  tokenAddress: string,
  chain: string,
  startTime: DateTime,
  endTime: DateTime,
  interval?: string
): Promise<Candle[]> {
  // Reuse the singleton client - don't create new one each time
  const ch = getClickHouseClient();
  
  const startUnix = Math.floor(startTime.toSeconds());
  const endUnix = Math.floor(endTime.toSeconds());
  
  // Build query with string interpolation (ClickHouse client has issues with query_params for mixed types)
  // Note: ClickHouse stores full addresses (e.g., with "pump" suffix), so we use LIKE to match
  const escapedTokenAddress = tokenAddress.replace(/'/g, "''");
  let query = `
    SELECT 
      toUnixTimestamp(timestamp) as timestamp,
      open,
      high,
      low,
      close,
      volume
    FROM ${CLICKHOUSE_DATABASE}.ohlcv_candles
    WHERE (token_address = '${escapedTokenAddress}' 
           OR lower(token_address) = lower('${escapedTokenAddress}')
           OR token_address LIKE '${escapedTokenAddress}%'
           OR lower(token_address) LIKE lower('${escapedTokenAddress}%')
           OR token_address LIKE CONCAT('%', '${escapedTokenAddress}')
           OR lower(token_address) LIKE lower(CONCAT('%', '${escapedTokenAddress}')))
      AND chain = '${chain.replace(/'/g, "''")}'
      AND timestamp >= toDateTime(${startUnix})
      AND timestamp <= toDateTime(${endUnix})
  `;
  
  if (interval) {
    // interval is a reserved keyword in ClickHouse, need to escape with backticks
    query += ` AND \`interval\` = '${interval.replace(/'/g, "''")}'`;
  }
  
  query += ` ORDER BY timestamp ASC`;
  
  // Retry logic for socket hang ups and connection errors
  const maxRetries = 3;
  let lastError: any = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Debug logging (display only - use full address in query)
      if (process.env.DEBUG_CLICKHOUSE === 'true') {
        logger.debug('ClickHouse query', { tokenAddress: tokenAddress.substring(0, 20), chain, startUnix, endUnix, attempt: attempt + 1 });
      }
      
      const result = await ch.query({
        query,
        format: 'JSONEachRow',
        clickhouse_settings: {
          max_execution_time: 30, // 30 seconds max execution time
        },
      });
      
      const data = await result.json() as Array<{
        timestamp: number; // Unix timestamp in seconds
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      }>;
      
      // Ensure we have an array
      if (!Array.isArray(data)) {
        return [];
      }
      
      return data.map(row => ({
        timestamp: row.timestamp, // Already in Unix seconds from toUnixTimestamp()
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
      }));
    } catch (error: any) {
      lastError = error;
      const isSocketError = error.message?.includes('socket hang up') || 
                           error.message?.includes('ECONNRESET') ||
                           error.message?.includes('ETIMEDOUT') ||
                           error.message?.includes('timeout');
      
      // Retry on socket/timeout errors, but not on other errors (like syntax errors)
      if (isSocketError && attempt < maxRetries - 1) {
        // Wait before retry (exponential backoff: 1s, 2s, 3s)
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
      
      // Silently fail if USE_CACHE_ONLY is set (will fallback to CSV cache)
      if (process.env.USE_CACHE_ONLY !== 'true' && !isSocketError) {
        logger.error('Error querying candles', error as Error, { tokenAddress });
      }
      return [];
    }
  }
  
  // If we exhausted retries, return empty array
  return [];
}

/**
 * Check if candles exist in ClickHouse for a given token and time range
 */
export async function hasCandles(
  tokenAddress: string,
  chain: string,
  startTime: DateTime,
  endTime: DateTime
): Promise<boolean> {
  const ch = getClickHouseClient();
  
  const startUnix = Math.floor(startTime.toSeconds());
  const endUnix = Math.floor(endTime.toSeconds());
  
  try {
    // Escape strings for SQL injection safety
    const escapedTokenAddress = tokenAddress.replace(/'/g, "''");
    const escapedChain = chain.replace(/'/g, "''");
    
    // Use same flexible matching as queryCandles
    const result = await ch.query({
      query: `
        SELECT count() as count
        FROM ${CLICKHOUSE_DATABASE}.ohlcv_candles
        WHERE (token_address = '${escapedTokenAddress}' 
               OR lower(token_address) = lower('${escapedTokenAddress}')
               OR token_address LIKE '${escapedTokenAddress}%'
               OR lower(token_address) LIKE lower('${escapedTokenAddress}%')
               OR token_address LIKE CONCAT('%', '${escapedTokenAddress}')
               OR lower(token_address) LIKE lower(CONCAT('%', '${escapedTokenAddress}')))
          AND chain = '${escapedChain}'
          AND timestamp >= toDateTime(${startUnix})
          AND timestamp <= toDateTime(${endUnix})
      `,
      format: 'JSONEachRow',
    });
    
    const data = await result.json() as Array<{ count: number }>;
    
    // Ensure we have an array
    if (!Array.isArray(data) || data.length === 0) {
      return false;
    }
    
    return data[0]?.count > 0 || false;
  } catch (error: any) {
    logger.error('Error checking candles', error as Error, { tokenAddress });
    return false;
  }
}

/**
 * Close ClickHouse client connection
 */
export async function closeClickHouse(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    logger.info('ClickHouse connection closed');
  }
}

