/**
 * TokenDataRepository - DuckDB repository for OHLCV coverage tracking
 *
 * Tracks which tokens have OHLCV data in ClickHouse and coverage statistics.
 * This is different from the Postgres TokenDataRepository which stored time-series metrics.
 */

import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import { join } from 'path';
import { z } from 'zod';
import { DuckDBClient } from '../duckdb-client';

export interface OHLCVCoverageRecord {
  mint: string;
  chain: string;
  interval: string;
  earliestTimestamp: DateTime | null;
  latestTimestamp: DateTime | null;
  candleCount: number;
  coveragePercent: number;
  lastUpdated: DateTime;
}

export interface TokenDataInsertData {
  mint: string;
  chain: string;
  interval: string;
  earliestTimestamp?: Date;
  latestTimestamp?: Date;
  candleCount: number;
  coveragePercent: number;
}

/**
 * DuckDB TokenDataRepository for OHLCV coverage
 */
export class TokenDataRepository {
  private client: DuckDBClient;
  private scriptPath: string;

  constructor(dbPath: string, client?: DuckDBClient) {
    this.client = client || new DuckDBClient(dbPath);
    this.scriptPath = join(process.cwd(), 'tools/storage/duckdb_token_data.py');
    this.initializeDatabase();
  }

  /**
   * Initialize DuckDB database and schema
   */
  private async initializeDatabase(): Promise<void> {
    try {
      await this.client.initSchema(this.scriptPath);
      logger.info('TokenDataRepository database initialized', { dbPath: this.client.getDbPath() });
    } catch (error) {
      logger.error('Failed to initialize TokenDataRepository database', error as Error, {
        dbPath: this.client.getDbPath(),
      });
      // Don't throw - allow service to continue with degraded functionality
    }
  }

  /**
   * Upsert OHLCV coverage record for a token
   */
  async upsertCoverage(data: TokenDataInsertData): Promise<void> {
    try {
      const resultSchema = z.object({
        success: z.boolean(),
        error: z.string().optional(),
      });

      await this.client.execute(
        this.scriptPath,
        'upsert',
        {
          data: JSON.stringify({
            mint: data.mint,
            chain: data.chain,
            interval: data.interval,
            earliest_timestamp: data.earliestTimestamp?.toISOString(),
            latest_timestamp: data.latestTimestamp?.toISOString(),
            candle_count: data.candleCount,
            coverage_percent: data.coveragePercent,
          }),
        },
        resultSchema
      );

      logger.debug('Upserted OHLCV coverage', {
        mint: data.mint.substring(0, 20),
        interval: data.interval,
        candleCount: data.candleCount,
      });
    } catch (error) {
      logger.error('Failed to upsert OHLCV coverage', error as Error, {
        mint: data.mint.substring(0, 20),
      });
      throw error;
    }
  }

  /**
   * Get OHLCV coverage for a token
   */
  async getCoverage(
    mint: string,
    chain: string,
    interval: string
  ): Promise<OHLCVCoverageRecord | null> {
    try {
      const resultSchema = z
        .object({
          mint: z.string(),
          chain: z.string(),
          interval: z.string(),
          earliest_timestamp: z.string().nullable(),
          latest_timestamp: z.string().nullable(),
          candle_count: z.number(),
          coverage_percent: z.number(),
          last_updated: z.string(),
        })
        .nullable();

      const result = await this.client.execute(
        this.scriptPath,
        'get',
        { mint, chain, interval },
        resultSchema
      );

      if (!result) {
        return null;
      }

      return {
        mint: result.mint,
        chain: result.chain,
        interval: result.interval,
        earliestTimestamp: result.earliest_timestamp
          ? DateTime.fromISO(result.earliest_timestamp)
          : null,
        latestTimestamp: result.latest_timestamp ? DateTime.fromISO(result.latest_timestamp) : null,
        candleCount: result.candle_count,
        coveragePercent: result.coverage_percent,
        lastUpdated: DateTime.fromISO(result.last_updated),
      };
    } catch (error) {
      logger.error('Failed to get OHLCV coverage', error as Error, {
        mint: mint.substring(0, 20),
      });
      throw error;
    }
  }

  /**
   * List all tokens with OHLCV coverage
   */
  async listCoverage(options?: {
    chain?: string;
    interval?: string;
    minCoverage?: number;
  }): Promise<OHLCVCoverageRecord[]> {
    try {
      const resultSchema = z.array(
        z.object({
          mint: z.string(),
          chain: z.string(),
          interval: z.string(),
          earliest_timestamp: z.string().nullable(),
          latest_timestamp: z.string().nullable(),
          candle_count: z.number(),
          coverage_percent: z.number(),
          last_updated: z.string(),
        })
      );

      const result = await this.client.execute(
        this.scriptPath,
        'list',
        {
          chain: options?.chain,
          interval: options?.interval,
          min_coverage: options?.minCoverage,
        },
        resultSchema
      );

      return result.map((row) => ({
        mint: row.mint,
        chain: row.chain,
        interval: row.interval,
        earliestTimestamp: row.earliest_timestamp ? DateTime.fromISO(row.earliest_timestamp) : null,
        latestTimestamp: row.latest_timestamp ? DateTime.fromISO(row.latest_timestamp) : null,
        candleCount: row.candle_count,
        coveragePercent: row.coverage_percent,
        lastUpdated: DateTime.fromISO(row.last_updated),
      }));
    } catch (error) {
      logger.error('Failed to list OHLCV coverage', error as Error);
      throw error;
    }
  }

  /**
   * Update coverage from ClickHouse query
   * Queries ClickHouse to get actual coverage and updates DuckDB
   */
  async updateCoverageFromClickHouse(mint: string, chain: string, interval: string): Promise<void> {
    // This would query ClickHouse to get actual candle counts and date ranges
    // For now, this is a placeholder - implementation would need ClickHouse client
    logger.debug('Update coverage from ClickHouse not yet implemented', {
      mint: mint.substring(0, 20),
      chain,
      interval,
    });
  }
}
