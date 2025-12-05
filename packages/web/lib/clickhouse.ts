// Utility to access ClickHouse client from parent directory
import * as path from 'path';
import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { DateTime } from 'luxon';

// ClickHouse connection configuration (same as parent project)
const CLICKHOUSE_HOST = process.env.CLICKHOUSE_HOST || 'localhost';
const CLICKHOUSE_PORT = process.env.CLICKHOUSE_PORT ? parseInt(process.env.CLICKHOUSE_PORT) : 8123;
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER || 'default';
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD || '';
const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

let client: ClickHouseClient | null = null;
let isHealthy = true;
let lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL = 60000; // 1 minute

export function getClickHouseClient(): ClickHouseClient {
  if (client && isHealthy) {
    return client;
  }
  
  const url = `http://${CLICKHOUSE_HOST}:${CLICKHOUSE_PORT}`;
  const config: any = {
    url: url,
    username: CLICKHOUSE_USER,
    database: CLICKHOUSE_DATABASE,
    request_timeout: 30000, // 30 seconds
    max_open_connections: 10,
  };
  
  if (CLICKHOUSE_PASSWORD && CLICKHOUSE_PASSWORD.trim() !== '') {
    config.password = CLICKHOUSE_PASSWORD;
  }
  
  client = createClient(config);
  return client;
}

export async function healthCheck(): Promise<boolean> {
  const now = Date.now();
  if (now - lastHealthCheck < HEALTH_CHECK_INTERVAL && isHealthy) {
    return isHealthy;
  }

  try {
    const ch = getClickHouseClient();
    await ch.ping();
    isHealthy = true;
    lastHealthCheck = now;
    return true;
  } catch (error) {
    isHealthy = false;
    lastHealthCheck = now;
    console.error('ClickHouse health check failed:', error);
    return false;
  }
}

// Retry logic for queries
async function queryWithRetry<T>(
  queryFn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await queryFn();
    } catch (error: any) {
      lastError = error;
      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs * Math.pow(2, attempt)));
      }
    }
  }
  
  throw lastError || new Error('Query failed after retries');
}

export async function queryCandles(
  tokenAddress: string,
  chain: string,
  startTime: Date,
  endTime: Date,
  interval: string
): Promise<any[]> {
  try {
    const ch = getClickHouseClient();
    const start = DateTime.fromJSDate(startTime);
    const end = DateTime.fromJSDate(endTime);
    
    const query = `
      SELECT 
        timestamp,
        open,
        high,
        low,
        close,
        volume
      FROM ${CLICKHOUSE_DATABASE}.ohlcv_candles
      WHERE token_address = {tokenAddress:String}
        AND chain = {chain:String}
        AND interval = {interval:String}
        AND timestamp >= {startTime:DateTime}
        AND timestamp <= {endTime:DateTime}
      ORDER BY timestamp ASC
    `;
    
    const result = await queryWithRetry(async () => {
      return await ch.query({
        query,
        query_params: {
          tokenAddress: tokenAddress.toLowerCase(),
          chain: chain.toLowerCase(),
          interval: interval,
          startTime: start.toISO()!,
          endTime: end.toISO()!,
        },
        format: 'JSONEachRow',
      });
    });
    
    const data = await result.json();
    return (data as any[]).map((row: any) => ({
      timestamp: new Date(row.timestamp).getTime() / 1000,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
    }));
  } catch (error) {
    console.error('Error querying ClickHouse:', error);
    return [];
  }
}

// Batch query multiple tokens at once
export async function queryCandlesBatch(
  queries: Array<{
    tokenAddress: string;
    chain: string;
    startTime: Date;
    endTime: Date;
    interval: string;
  }>
): Promise<Map<string, any[]>> {
  const results = new Map<string, any[]>();
  const BATCH_SIZE = 5; // Limit concurrent queries
  
  for (let i = 0; i < queries.length; i += BATCH_SIZE) {
    const batch = queries.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (q) => {
        const key = `${q.chain}:${q.tokenAddress}:${q.startTime.getTime()}:${q.endTime.getTime()}`;
        const candles = await queryCandles(
          q.tokenAddress,
          q.chain,
          q.startTime,
          q.endTime,
          q.interval
        );
        return { key, candles };
      })
    );
    
    batchResults.forEach(({ key, candles }) => {
      results.set(key, candles);
    });
  }
  
  return results;
}

