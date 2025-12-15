/**
 * OhlcvRepository - ClickHouse repository for OHLCV candles
 *
 * Handles all database operations for ohlcv_candles table.
 * CRITICAL: Always preserve full token address and exact case.
 */

import { DateTime } from 'luxon';
import { getClickHouseClient } from '../../clickhouse-client';
import { logger } from '@quantbot/utils';
import type { Candle, DateRange } from '@quantbot/core';

export class OhlcvRepository {
  /**
   * Upsert candles for a token
   * CRITICAL: Preserves full address and exact case
   */
  async upsertCandles(
    token: string, // Full mint address, case-preserved
    chain: string,
    interval: string,
    candles: Candle[]
  ): Promise<void> {
    if (candles.length === 0) {
      return;
    }

    const ch = getClickHouseClient();
    const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

    const rows = candles.map((candle) => ({
      token_address: token, // Full address, case-preserved
      chain: chain,
      timestamp: DateTime.fromSeconds(candle.timestamp).toFormat('yyyy-MM-dd HH:mm:ss'),
      interval: interval,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      // Note: is_backfill column removed - table doesn't have this column
    }));

    try {
      await ch.insert({
        table: `${CLICKHOUSE_DATABASE}.ohlcv_candles`,
        values: rows,
        format: 'JSONEachRow',
      });

      logger.debug('Upserted candles', {
        token: token.substring(0, 20) + '...', // Display only
        chain,
        interval,
        count: candles.length,
      });
    } catch (error: unknown) {
      if (process.env.USE_CACHE_ONLY !== 'true') {
        logger.error('Error upserting candles', error as Error, {
          token: token.substring(0, 20) + '...', // Display only
        });
        throw error;
      }
      // Silently fail in cache-only mode
    }
  }

  /**
   * Get candles for a token in a time range
   * CRITICAL: Uses full address, case-preserved
   *
   * @param token Full mint address, case-preserved
   * @param chain Chain identifier
   * @param interval Candle interval ('1m', '5m', '15m', '1h', '4h', '1d')
   * @param range Date range for query
   */
  async getCandles(
    token: string, // Full mint address, case-preserved
    chain: string,
    interval: string,
    range: DateRange
  ): Promise<Candle[]> {
    const ch = getClickHouseClient();
    const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

    // Convert DateTime to Unix timestamp (seconds)
    const startUnix = range.from.toUnixInteger();
    const endUnix = range.to.toUnixInteger();

    // Use parameterized queries to prevent SQL injection
    // Note: ClickHouse parameterized queries use {paramName:Type} syntax
    // For LIKE patterns, we need to construct the pattern as a parameter
    const tokenPattern = `${token}%`;
    const tokenPatternSuffix = `%${token}`;

    const query = `
      SELECT 
        toUnixTimestamp(timestamp) as timestamp,
        open,
        high,
        low,
        close,
        volume
      FROM ${CLICKHOUSE_DATABASE}.ohlcv_candles
      WHERE (token_address = {tokenAddress:String}
             OR lower(token_address) = lower({tokenAddress:String})
             OR token_address LIKE {tokenPattern:String}
             OR lower(token_address) LIKE lower({tokenPattern:String})
             OR token_address LIKE {tokenPatternSuffix:String}
             OR lower(token_address) LIKE lower({tokenPatternSuffix:String}))
        AND chain = {chain:String}
        AND \`interval\` = {interval:String}
        AND timestamp >= toDateTime({startUnix:UInt32})
        AND timestamp <= toDateTime({endUnix:UInt32})
      ORDER BY timestamp ASC
    `;

    try {
      const result = await ch.query({
        query,
        query_params: {
          tokenAddress: token,
          tokenPattern: tokenPattern,
          tokenPatternSuffix: tokenPatternSuffix,
          chain: chain,
          interval: interval,
          startUnix: startUnix,
          endUnix: endUnix,
        },
        format: 'JSONEachRow',
        clickhouse_settings: {
          max_execution_time: 30,
        },
      });

      const data = (await result.json()) as Array<{
        timestamp: number;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      }>;

      if (!Array.isArray(data)) {
        return [];
      }

      return data.map((row) => ({
        timestamp: row.timestamp,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
      }));
    } catch (error: unknown) {
      if (process.env.USE_CACHE_ONLY !== 'true') {
        logger.error('Error querying candles', error as Error, {
          token: token.substring(0, 20) + '...', // Display only
        });
      }
      return [];
    }
  }

  /**
   * Check if candles exist for a token in a time range
   */
  async hasCandles(token: string, chain: string, range: DateRange): Promise<boolean> {
    const ch = getClickHouseClient();
    const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

    // Convert DateTime to Unix timestamp (seconds)
    const startUnix = range.from.toUnixInteger();
    const endUnix = range.to.toUnixInteger();

    // Use parameterized queries to prevent SQL injection
    const tokenPattern = `${token}%`;
    const tokenPatternSuffix = `%${token}`;

    try {
      const result = await ch.query({
        query: `
          SELECT count() as count
          FROM ${CLICKHOUSE_DATABASE}.ohlcv_candles
          WHERE (token_address = {tokenAddress:String}
                 OR lower(token_address) = lower({tokenAddress:String})
                 OR token_address LIKE {tokenPattern:String}
                 OR lower(token_address) LIKE lower({tokenPattern:String})
                 OR token_address LIKE {tokenPatternSuffix:String}
                 OR lower(token_address) LIKE lower({tokenPatternSuffix:String}))
            AND chain = {chain:String}
            AND timestamp >= toDateTime({startUnix:UInt32})
            AND timestamp <= toDateTime({endUnix:UInt32})
        `,
        query_params: {
          tokenAddress: token,
          tokenPattern: tokenPattern,
          tokenPatternSuffix: tokenPatternSuffix,
          chain: chain,
          startUnix: startUnix,
          endUnix: endUnix,
        },
        format: 'JSONEachRow',
      });

      const data = (await result.json()) as Array<{ count: number }>;

      if (!Array.isArray(data) || data.length === 0) {
        return false;
      }

      return data[0]?.count > 0 || false;
    } catch (error: unknown) {
      logger.error('Error checking candles', error as Error, {
        token: token.substring(0, 20) + '...', // Display only
      });
      return false;
    }
  }
}
