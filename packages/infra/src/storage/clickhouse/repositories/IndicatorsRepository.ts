/**
 * IndicatorsRepository - ClickHouse repository for computed indicator values
 *
 * Stores and retrieves computed technical indicator values (Ichimoku, EMA, RSI, etc.)
 * for efficient querying and reuse across simulations.
 *
 * CRITICAL: Always preserve full token address and exact case.
 */

import { DateTime } from 'luxon';
import { getClickHouseClient } from '../../clickhouse-client.js';
import { logger } from '../../../utils/index.js';

export interface IndicatorValue {
  indicatorType: string;
  value: number | Record<string, number>;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export class IndicatorsRepository {
  /**
   * Ensure indicators table exists
   */
  async ensureTable(): Promise<void> {
    const ch = getClickHouseClient();
    const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

    await ch.exec({
      query: `
        CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.indicator_values (
          token_address String,
          chain String,
          timestamp DateTime,
          indicator_type String,
          value_json String,
          metadata_json String
        )
        ENGINE = MergeTree()
        PARTITION BY (chain, toYYYYMM(timestamp))
        ORDER BY (token_address, chain, timestamp, indicator_type)
        SETTINGS index_granularity = 8192
      `,
    });
  }

  /**
   * Upsert indicator values for a token at a specific timestamp
   * CRITICAL: Preserves full address and exact case
   */
  async upsertIndicators(
    tokenAddress: string,
    chain: string,
    timestamp: number,
    indicators: IndicatorValue[]
  ): Promise<void> {
    if (indicators.length === 0) return;

    await this.ensureTable();

    const ch = getClickHouseClient();
    const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

    const rows = indicators.map((indicator) => ({
      token_address: tokenAddress, // Full address, case-preserved
      chain: chain,
      timestamp: DateTime.fromSeconds(timestamp).toFormat('yyyy-MM-dd HH:mm:ss'),
      indicator_type: indicator.indicatorType,
      value_json: JSON.stringify(indicator.value),
      metadata_json: indicator.metadata ? JSON.stringify(indicator.metadata) : '{}',
    }));

    try {
      await ch.insert({
        table: `${CLICKHOUSE_DATABASE}.indicator_values`,
        values: rows,
        format: 'JSONEachRow',
      });

      logger.debug('Upserted indicator values', {
        token: tokenAddress,
        chain,
        count: indicators.length,
      });
    } catch (error: unknown) {
      logger.error('Error upserting indicator values', error as Error, {
        token: tokenAddress,
      });
      throw error;
    }
  }

  /**
   * Get indicator values for a token in a time range
   * CRITICAL: Uses full address, case-preserved
   *
   * Returns a Map where keys are timestamps (unix seconds) and values are arrays of IndicatorValue
   */
  async getIndicators(
    tokenAddress: string,
    chain: string,
    startTime: DateTime,
    endTime: DateTime,
    indicatorTypes?: string[]
  ): Promise<Map<number, IndicatorValue[]>> {
    await this.ensureTable();

    const ch = getClickHouseClient();
    const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

    const startUnix = Math.floor(startTime.toSeconds());
    const endUnix = Math.floor(endTime.toSeconds());

    // Build query with string interpolation
    const escapedTokenAddress = tokenAddress.replace(/'/g, "''");
    let query = `
      SELECT 
        toUnixTimestamp(timestamp) as timestamp,
        indicator_type,
        value_json,
        metadata_json
      FROM ${CLICKHOUSE_DATABASE}.indicator_values
      WHERE (token_address = '${escapedTokenAddress}' 
             OR lower(token_address) = lower('${escapedTokenAddress}'))
        AND chain = '${chain.replace(/'/g, "''")}'
        AND timestamp >= toDateTime(${startUnix})
        AND timestamp <= toDateTime(${endUnix})
    `;

    if (indicatorTypes && indicatorTypes.length > 0) {
      const escapedTypes = indicatorTypes.map((t) => `'${t.replace(/'/g, "''")}'`).join(',');
      query += ` AND indicator_type IN (${escapedTypes})`;
    }

    query += ` ORDER BY timestamp ASC, indicator_type ASC`;

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
        indicator_type: string;
        value_json: string;
        metadata_json: string;
      }>;

      // Group by timestamp
      const indicatorsByTimestamp = new Map<number, IndicatorValue[]>();

      for (const row of data) {
        const timestamp = row.timestamp;
        const indicator: IndicatorValue = {
          indicatorType: row.indicator_type,
          value: JSON.parse(row.value_json),
          timestamp,
          metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
        };

        if (!indicatorsByTimestamp.has(timestamp)) {
          indicatorsByTimestamp.set(timestamp, []);
        }
        indicatorsByTimestamp.get(timestamp)!.push(indicator);
      }

      return indicatorsByTimestamp;
    } catch (error: unknown) {
      logger.error('Error querying indicator values', error as Error, {
        token: tokenAddress,
      });
      return new Map();
    }
  }

  /**
   * Get latest indicator values for a token
   */
  async getLatestIndicators(
    tokenAddress: string,
    chain: string,
    indicatorTypes?: string[]
  ): Promise<IndicatorValue[]> {
    await this.ensureTable();

    const ch = getClickHouseClient();
    const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

    const escapedTokenAddress = tokenAddress.replace(/'/g, "''");
    let query = `
      SELECT 
        toUnixTimestamp(timestamp) as timestamp,
        indicator_type,
        value_json,
        metadata_json
      FROM ${CLICKHOUSE_DATABASE}.indicator_values
      WHERE (token_address = '${escapedTokenAddress}' 
             OR lower(token_address) = lower('${escapedTokenAddress}'))
        AND chain = '${chain.replace(/'/g, "''")}'
    `;

    if (indicatorTypes && indicatorTypes.length > 0) {
      const escapedTypes = indicatorTypes.map((t) => `'${t.replace(/'/g, "''")}'`).join(',');
      query += ` AND indicator_type IN (${escapedTypes})`;
    }

    query += `
      ORDER BY timestamp DESC
      LIMIT 100
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
        indicator_type: string;
        value_json: string;
        metadata_json: string;
      }>;

      return data.map((row) => ({
        indicatorType: row.indicator_type,
        value: JSON.parse(row.value_json),
        timestamp: row.timestamp,
        metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
      }));
    } catch (error: unknown) {
      logger.error('Error querying latest indicator values', error as Error, {
        token: tokenAddress,
      });
      return [];
    }
  }

  /**
   * Delete old indicator values (cleanup)
   */
  async deleteOldIndicators(beforeTimestamp: DateTime, chain?: string): Promise<number> {
    await this.ensureTable();

    const ch = getClickHouseClient();
    const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

    const beforeUnix = Math.floor(beforeTimestamp.toSeconds());

    let query = `
      ALTER TABLE ${CLICKHOUSE_DATABASE}.indicator_values
      DELETE WHERE timestamp < toDateTime(${beforeUnix})
    `;

    if (chain) {
      query += ` AND chain = '${chain.replace(/'/g, "''")}'`;
    }

    try {
      await ch.exec({ query });
      logger.info('Deleted old indicator values', { beforeTimestamp: beforeTimestamp.toISO() });
      // Note: ClickHouse DELETE returns void, we can't get count easily
      return 0;
    } catch (error: unknown) {
      logger.error('Error deleting old indicator values', error as Error);
      throw error;
    }
  }
}
