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
      is_backfill: 0,
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
   */
  async getCandles(
    token: string, // Full mint address, case-preserved
    chain: string,
    interval: string,
    range: DateRange
  ): Promise<Candle[]> {
    const ch = getClickHouseClient();
    const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

    const startUnix = Math.floor(range.from.getTime() / 1000);
    const endUnix = Math.floor(range.to.getTime() / 1000);

    // Escape for SQL injection safety
    const escapedTokenAddress = token.replace(/'/g, "''");
    const escapedChain = chain.replace(/'/g, "''");
    const escapedInterval = interval.replace(/'/g, "''");

    // Use flexible matching (handles pump.fun addresses with suffixes)
    const query = `
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
        AND chain = '${escapedChain}'
        AND \`interval\` = '${escapedInterval}'
        AND timestamp >= toDateTime(${startUnix})
        AND timestamp <= toDateTime(${endUnix})
      ORDER BY timestamp ASC
    `;

    try {
      const result = await ch.query({
        query,
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

    const startUnix = Math.floor(range.from.getTime() / 1000);
    const endUnix = Math.floor(range.to.getTime() / 1000);

    const escapedTokenAddress = token.replace(/'/g, "''");
    const escapedChain = chain.replace(/'/g, "''");

    try {
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

