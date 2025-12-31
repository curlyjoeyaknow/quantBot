/**
 * OhlcvRepository - ClickHouse repository for OHLCV candles
 *
 * Handles all database operations for ohlcv_candles table.
 * CRITICAL: Always preserve full token address and exact case.
 */

import { DateTime } from 'luxon';
import { getClickHouseClient } from '../../clickhouse-client.js';
import { getClickHouseDatabaseName, logger, ValidationError } from '@quantbot/utils';
import type { Candle, DateRange } from '@quantbot/core';
import { normalizeChain } from '@quantbot/core';

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
    const database = getClickHouseDatabaseName();

    // Normalize chain name to lowercase canonical form
    const normalizedChain = normalizeChain(chain);

    const rows = candles.map((candle) => ({
      token_address: token, // Full address, case-preserved
      chain: normalizedChain, // Normalized to lowercase (solana, ethereum, bsc, base, monad, evm)
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
        table: `${database}.ohlcv_candles`,
        values: rows,
        format: 'JSONEachRow',
      });

      logger.debug('Upserted candles', {
        token: token,
        chain,
        interval,
        count: candles.length,
      });
    } catch (error: unknown) {
      if (process.env.USE_CACHE_ONLY !== 'true') {
        logger.error('Error upserting candles', error as Error, {
          token: token,
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
   * @param interval Candle interval ('1s', '15s', '1m', '5m', '15m', '1h', '4h', '1d')
   * @param range Date range for query
   */
  async getCandles(
    token: string, // Full mint address, case-preserved
    chain: string,
    interval: string,
    range: DateRange
  ): Promise<Candle[]> {
    const ch = getClickHouseClient();
    const database = getClickHouseDatabaseName();

    // Validate chain to prevent SQL injection (whitelist approach)
    const validChains = ['solana', 'ethereum', 'bsc', 'base'];
    if (!validChains.includes(chain)) {
      throw new ValidationError(
        `Invalid chain: ${chain}. Must be one of: ${validChains.join(', ')}`,
        {
          chain,
          validChains,
        }
      );
    }

    // Validate interval to prevent SQL injection (whitelist approach)
    const validIntervals = ['1s', '15s', '1m', '5m', '15m', '1h', '4h', '1d'];
    if (!validIntervals.includes(interval)) {
      throw new ValidationError(
        `Invalid interval: ${interval}. Must be one of: ${validIntervals.join(', ')}`,
        { interval, validIntervals }
      );
    }

    // Convert DateTime to Unix timestamp (seconds)
    const startUnix = range.from.toUnixInteger();
    const endUnix = range.to.toUnixInteger();

    // Escape values for SQL injection prevention
    const escapedToken = token.replace(/'/g, "''");
    const escapedChain = chain.replace(/'/g, "''");
    const escapedInterval = interval.replace(/'/g, "''");
    const tokenPattern = `${token}%`;
    const tokenPatternSuffix = `%${token}`;
    const escapedTokenPattern = tokenPattern.replace(/'/g, "''");
    const escapedTokenPatternSuffix = tokenPatternSuffix.replace(/'/g, "''");

    // Build query with string interpolation (properly escaped to prevent SQL injection)
    // Using string interpolation instead of parameterized queries to avoid "Unknown setting param_*" error
    const query = `
      SELECT 
        toUnixTimestamp(timestamp) as timestamp,
        open,
        high,
        low,
        close,
        volume
      FROM ${database}.ohlcv_candles
      WHERE (token_address = '${escapedToken}'
             OR lower(token_address) = lower('${escapedToken}')
             OR token_address LIKE '${escapedTokenPattern}'
             OR lower(token_address) LIKE lower('${escapedTokenPattern}')
             OR token_address LIKE '${escapedTokenPatternSuffix}'
             OR lower(token_address) LIKE lower('${escapedTokenPatternSuffix}'))
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
          token: token,
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
    const database = getClickHouseDatabaseName();

    // Convert DateTime to Unix timestamp (seconds)
    const startUnix = range.from.toUnixInteger();
    const endUnix = range.to.toUnixInteger();

    // Escape values for SQL injection prevention
    const escapedToken = token.replace(/'/g, "''");
    const escapedChain = chain.replace(/'/g, "''");
    const tokenPattern = `${token}%`;
    const tokenPatternSuffix = `%${token}`;
    const escapedTokenPattern = tokenPattern.replace(/'/g, "''");
    const escapedTokenPatternSuffix = tokenPatternSuffix.replace(/'/g, "''");

    // Build query with string interpolation (properly escaped to prevent SQL injection)
    try {
      const result = await ch.query({
        query: `
          SELECT count() as count
          FROM ${database}.ohlcv_candles
          WHERE (token_address = '${escapedToken}'
                 OR lower(token_address) = lower('${escapedToken}')
                 OR token_address LIKE '${escapedTokenPattern}'
                 OR lower(token_address) LIKE lower('${escapedTokenPattern}')
                 OR token_address LIKE '${escapedTokenPatternSuffix}'
                 OR lower(token_address) LIKE lower('${escapedTokenPatternSuffix}'))
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
        token: token,
      });
      return false;
    }
  }
}
