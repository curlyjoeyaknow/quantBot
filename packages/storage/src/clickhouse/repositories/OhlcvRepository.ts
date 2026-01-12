/**
 * OhlcvRepository - ClickHouse repository for OHLCV candles
 *
 * Handles all database operations for per-interval ohlcv_candles tables.
 * CRITICAL: Always preserve full token address and exact case.
 *
 * Now with:
 * - Per-interval tables (ohlcv_candles_1m, ohlcv_candles_5m)
 * - Quality-based deduplication (ReplacingMergeTree)
 * - Validation before insertion
 * - Audit trail (run_id, script_version)
 */

import { DateTime } from 'luxon';
import { getClickHouseClient } from '../../clickhouse-client.js';
import { logger, ValidationError } from '@quantbot/utils';
import type { Candle, DateRange } from '@quantbot/core';
import { normalizeChain } from '@quantbot/core';
import { intervalToSeconds } from '../../utils/interval-converter.js';
import {
  validateCandleBatch,
  STRICT_VALIDATION,
  type QualityValidationOptions,
} from '../validation/candle-validator.js';
import {
  computeQualityScore,
  SourceTier,
  type IngestionRunManifest,
} from '../types/quality-score.js';

export interface UpsertResult {
  inserted: number;
  rejected: number;
  warnings: number;
  rejectionDetails: Array<{
    timestamp: number;
    errors: string[];
  }>;
}

export class OhlcvRepository {
  // Maximum candles per INSERT to prevent EPIPE errors from oversized payloads
  private static readonly BATCH_SIZE = 10000;

  /**
   * Upsert candles for a token with validation and quality scoring.
   * CRITICAL: Preserves full address and exact case
   *
   * Now with:
   * - Validation before insertion (corruption and quality checks)
   * - Quality score computation (volume-weighted, data-derived)
   * - Run manifest tracking (audit trail)
   * - Per-interval table routing
   *
   * Large candle arrays are automatically batched to prevent ClickHouse
   * connection issues (EPIPE errors) from oversized INSERT statements.
   */
  async upsertCandles(
    token: string, // Full mint address, case-preserved
    chain: string,
    interval: string,
    candles: Candle[],
    options: {
      runManifest: IngestionRunManifest;
      validation?: QualityValidationOptions;
      sourceTier?: SourceTier;
    }
  ): Promise<UpsertResult> {
    if (candles.length === 0) {
      return {
        inserted: 0,
        rejected: 0,
        warnings: 0,
        rejectionDetails: [],
      };
    }

    const ch = getClickHouseClient();
    const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

    // Validation and quality options
    const validation = options.validation ?? STRICT_VALIDATION;
    const sourceTier = options.sourceTier ?? options.runManifest.sourceTier;

    // Validate candles before insertion
    const { valid, rejected, warningCount } = validateCandleBatch(candles, validation);

    if (valid.length === 0) {
      return {
        inserted: 0,
        rejected: candles.length,
        warnings: 0,
        rejectionDetails: rejected.map((r) => ({
          timestamp: r.candle.timestamp,
          errors: r.errors,
        })),
      };
    }

    // Normalize chain name to lowercase canonical form
    const normalizedChain = normalizeChain(chain);

    // Convert interval string to seconds (UInt32) for storage
    const intervalSeconds = intervalToSeconds(interval);

    // Route to correct per-interval table
    const tableName = this.getTableNameForInterval(interval);

    // Generate ingestion metadata
    const ingestionTimestamp = DateTime.utc();

    // Convert validated candles to row format with quality scores
    const allRows = valid.map((candle) => {
      const qualityScore = computeQualityScore(candle, sourceTier);
      return {
        token_address: token, // Full address, case-preserved
        chain: normalizedChain, // Normalized to lowercase (solana, ethereum, bsc, base, monad, evm)
        timestamp: DateTime.fromSeconds(candle.timestamp).toFormat('yyyy-MM-dd HH:mm:ss'),
        interval_seconds: intervalSeconds, // Store as UInt32 seconds (e.g., 300 for '5m', 1 for '1s')
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        quality_score: qualityScore, // Computed from data
        ingested_at: ingestionTimestamp.toFormat('yyyy-MM-dd HH:mm:ss'),
        source_tier: sourceTier,
        ingestion_run_id: options.runManifest.runId,
        script_version: options.runManifest.scriptVersion,
      };
    });

    // Batch inserts to prevent EPIPE errors from oversized payloads
    const totalBatches = Math.ceil(allRows.length / OhlcvRepository.BATCH_SIZE);

    try {
      for (let i = 0; i < allRows.length; i += OhlcvRepository.BATCH_SIZE) {
        const batchRows = allRows.slice(i, i + OhlcvRepository.BATCH_SIZE);
        const batchNum = Math.floor(i / OhlcvRepository.BATCH_SIZE) + 1;

        await ch.insert({
          table: `${CLICKHOUSE_DATABASE}.${tableName}`,
          values: batchRows,
          format: 'JSONEachRow',
        });

        if (totalBatches > 1) {
          logger.debug(`Upserted candle batch ${batchNum}/${totalBatches}`, {
            token: token,
            chain,
            interval,
            table: tableName,
            batchSize: batchRows.length,
            totalCandles: valid.length,
          });
        }
      }

      logger.debug('Upserted candles', {
        token: token,
        chain,
        interval,
        table: tableName,
        inserted: valid.length,
        rejected: rejected.length,
        warnings: warningCount,
        batches: totalBatches,
      });

      return {
        inserted: valid.length,
        rejected: rejected.length,
        warnings: warningCount,
        rejectionDetails: rejected.map((r) => ({
          timestamp: r.candle.timestamp,
          errors: r.errors,
        })),
      };
    } catch (error: unknown) {
      if (process.env.USE_CACHE_ONLY !== 'true') {
        logger.error('Error upserting candles', error as Error, {
          token: token,
          count: candles.length,
          table: tableName,
        });
        throw error;
      }
      // Silently fail in cache-only mode
      return {
        inserted: 0,
        rejected: 0,
        warnings: 0,
        rejectionDetails: [],
      };
    }
  }

  /**
   * Get table name for interval.
   */
  private getTableNameForInterval(interval: string): string {
    const mapping: Record<string, string> = {
      '1m': 'ohlcv_candles_1m',
      '5m': 'ohlcv_candles_5m',
    };

    const table = mapping[interval];
    if (!table) {
      throw new ValidationError(
        `Unknown interval: ${interval}. Supported: ${Object.keys(mapping).join(', ')}`,
        {
          interval,
          validIntervals: Object.keys(mapping),
        }
      );
    }

    return table;
  }

  /**
   * Get candles for a token in a time range with guaranteed deduplication.
   * CRITICAL: Uses full address, case-preserved
   *
   * Uses GROUP BY with argMax to guarantee deduplication at query time.
   * Picks values from row with highest (quality_score, ingested_at).
   *
   * @param token Full mint address, case-preserved
   * @param chain Chain identifier
   * @param interval Candle interval ('1m', '5m')
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

    // Route to correct per-interval table
    const tableName = this.getTableNameForInterval(interval);

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

    // Build query with GROUP BY + argMax for guaranteed deduplication
    // Picks values from row with highest (quality_score, ingested_at)
    const query = `
      SELECT 
        toUnixTimestamp(timestamp) as timestamp,
        argMax(open, (quality_score, ingested_at)) as open,
        argMax(high, (quality_score, ingested_at)) as high,
        argMax(low, (quality_score, ingested_at)) as low,
        argMax(close, (quality_score, ingested_at)) as close,
        argMax(volume, (quality_score, ingested_at)) as volume
      FROM ${CLICKHOUSE_DATABASE}.${tableName}
      WHERE (token_address = '${escapedToken}'
             OR lower(token_address) = lower('${escapedToken}')
             OR token_address LIKE '${escapedTokenPattern}'
             OR lower(token_address) LIKE lower('${escapedTokenPattern}')
             OR token_address LIKE '${escapedTokenPatternSuffix}'
             OR lower(token_address) LIKE lower('${escapedTokenPatternSuffix}'))
        AND chain = '${escapedChain}'
        AND timestamp >= toDateTime(${startUnix})
        AND timestamp <= toDateTime(${endUnix})
      GROUP BY token_address, chain, timestamp
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
          table: tableName,
        });
      }
      return [];
    }
  }

  /**
   * Check if candles exist for a token in a time range.
   * Checks all supported interval tables.
   */
  async hasCandles(
    token: string,
    chain: string,
    range: DateRange,
    interval?: string
  ): Promise<boolean> {
    const ch = getClickHouseClient();
    const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

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

    // Determine which tables to check
    const tablesToCheck = interval
      ? [this.getTableNameForInterval(interval)]
      : this.INTERVAL_TABLES;

    try {
      for (const table of tablesToCheck) {
        const result = await ch.query({
          query: `
            SELECT count() as count
            FROM ${CLICKHOUSE_DATABASE}.${table}
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

        if (Array.isArray(data) && data.length > 0 && (data[0]?.count ?? 0) > 0) {
          return true;
        }
      }

      return false;
    } catch (error: unknown) {
      logger.error('Error checking candles', error as Error, {
        token: token,
        tablesToCheck,
      });
      return false;
    }
  }

  private readonly INTERVAL_TABLES = ['ohlcv_candles_1m', 'ohlcv_candles_5m'];
}
