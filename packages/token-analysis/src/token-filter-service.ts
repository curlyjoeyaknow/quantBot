/**
 * Token Filtering & Query Service
 * 
 * Filters tokens from ClickHouse and SQLite based on user criteria.
 * Supports complex filtering by chain, date range, volume, price, caller, etc.
 */

import { DateTime } from 'luxon';
import { getClickHouseClient } from '@quantbot/data';
import { tokenService, type TokenMetadata } from './token-service';
import { logger } from '@quantbot/utils';
import * as sqlite3 from 'sqlite3';
import { promisify } from 'util';
import * as path from 'path';

export interface TokenFilterCriteria {
  chain?: string;
  dateRange?: {
    start: DateTime;
    end: DateTime;
  };
  volumeRange?: {
    min?: number;
    max?: number;
  };
  priceRange?: {
    min?: number;
    max?: number;
  };
  caller?: string;
  marketCapRange?: {
    min?: number;
    max?: number;
  };
  liquidityRange?: {
    min?: number;
    max?: number;
  };
  hasCandleData?: boolean;
  limit?: number;
  offset?: number;
}

export interface FilteredToken extends TokenMetadata {
  hasCandleData?: boolean;
  lastCandleTime?: DateTime;
  avgVolume?: number;
  avgPrice?: number;
}

const DB_PATH = path.join(process.cwd(), 'simulations.db');

/**
 * Token Filter Service for querying tokens with complex criteria
 */
export class TokenFilterService {
  /**
   * Filter tokens based on criteria
   */
  async filterTokens(criteria: TokenFilterCriteria): Promise<FilteredToken[]> {
    try {
      // Start with tokens from SQLite registry
      const sqliteFilters: any = {};
      if (criteria.chain) {
        sqliteFilters.chain = criteria.chain;
      }

      let tokens = await tokenService.listTokens(sqliteFilters);

      // If no tokens in registry but we have criteria, we might need to query ClickHouse directly
      if (tokens.length === 0 && criteria.hasCandleData) {
        tokens = await this.getTokensFromClickHouse(criteria);
      }

      // Apply filters
      const filtered: FilteredToken[] = [];

      for (const token of tokens) {
        const filteredToken: FilteredToken = { ...token };

        // Check if token has candle data in ClickHouse
        if (criteria.hasCandleData !== undefined) {
          const hasData = await this.checkTokenHasCandleData(
            token.mint,
            token.chain,
            criteria.dateRange
          );
          if (criteria.hasCandleData && !hasData) {
            continue;
          }
          if (!criteria.hasCandleData && hasData) {
            continue;
          }
          filteredToken.hasCandleData = hasData;
        }

        // Get additional data from ClickHouse if needed
        if (criteria.volumeRange || criteria.priceRange) {
          const stats = await this.getTokenStats(
            token.mint,
            token.chain,
            criteria.dateRange
          );
          filteredToken.avgVolume = stats.avgVolume;
          filteredToken.avgPrice = stats.avgPrice;
          filteredToken.lastCandleTime = stats.lastCandleTime;

          // Apply volume filter
          if (criteria.volumeRange) {
            const { min, max } = criteria.volumeRange;
            if (min !== undefined && (stats.avgVolume || 0) < min) {
              continue;
            }
            if (max !== undefined && (stats.avgVolume || 0) > max) {
              continue;
            }
          }

          // Apply price filter
          if (criteria.priceRange) {
            const { min, max } = criteria.priceRange;
            if (min !== undefined && (stats.avgPrice || 0) < min) {
              continue;
            }
            if (max !== undefined && (stats.avgPrice || 0) > max) {
              continue;
            }
          }
        }

        // Filter by caller (from ca_calls table)
        if (criteria.caller) {
          const hasCaller = await this.checkTokenHasCaller(
            token.mint,
            token.chain,
            criteria.caller,
            criteria.dateRange
          );
          if (!hasCaller) {
            continue;
          }
        }

        filtered.push(filteredToken);
      }

      // Apply limit and offset
      const offset = criteria.offset || 0;
      const limit = criteria.limit || filtered.length;

      return filtered.slice(offset, offset + limit);
    } catch (error: any) {
      logger.error('Failed to filter tokens', error as Error, { criteria });
      throw error;
    }
  }

  /**
   * Get tokens directly from ClickHouse (for tokens not in SQLite registry)
   */
  private async getTokensFromClickHouse(
    criteria: TokenFilterCriteria
  ): Promise<TokenMetadata[]> {
    try {
      const ch = getClickHouseClient();
      const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

      let query = `
        SELECT DISTINCT token_address as mint, chain
        FROM ${CLICKHOUSE_DATABASE}.ohlcv_candles
        WHERE 1=1
      `;

      if (criteria.chain) {
        query += ` AND chain = '${criteria.chain.replace(/'/g, "''")}'`;
      }

      if (criteria.dateRange) {
        const startUnix = Math.floor(criteria.dateRange.start.toSeconds());
        const endUnix = Math.floor(criteria.dateRange.end.toSeconds());
        query += ` AND timestamp >= toDateTime(${startUnix}) AND timestamp <= toDateTime(${endUnix})`;
      }

      query += ` ORDER BY mint LIMIT ${criteria.limit || 1000}`;

      const result = await ch.query({
        query,
        format: 'JSONEachRow',
      });

      const data = (await result.json()) as Array<{ mint: string; chain: string }>;

      return data.map((row) => ({
        mint: row.mint,
        chain: row.chain,
      }));
    } catch (error: any) {
      logger.error('Failed to get tokens from ClickHouse', error as Error);
      return [];
    }
  }

  /**
   * Check if token has candle data in ClickHouse
   */
  private async checkTokenHasCandleData(
    mint: string,
    chain: string,
    dateRange?: { start: DateTime; end: DateTime }
  ): Promise<boolean> {
    try {
      const ch = getClickHouseClient();
      const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

      let query = `
        SELECT count() as count
        FROM ${CLICKHOUSE_DATABASE}.ohlcv_candles
        WHERE token_address = '${mint.replace(/'/g, "''")}' AND chain = '${chain.replace(/'/g, "''")}'
      `;

      if (dateRange) {
        const startUnix = Math.floor(dateRange.start.toSeconds());
        const endUnix = Math.floor(dateRange.end.toSeconds());
        query += ` AND timestamp >= toDateTime(${startUnix}) AND timestamp <= toDateTime(${endUnix})`;
      }

      const result = await ch.query({
        query,
        format: 'JSONEachRow',
      });

      const data = (await result.json()) as Array<{ count: number }>;
      return (data[0]?.count || 0) > 0;
    } catch (error: any) {
      logger.warn('Failed to check candle data', { error: error.message, mint: mint.substring(0, 20) });
      return false;
    }
  }

  /**
   * Get token statistics from ClickHouse
   */
  private async getTokenStats(
    mint: string,
    chain: string,
    dateRange?: { start: DateTime; end: DateTime }
  ): Promise<{
    avgVolume: number;
    avgPrice: number;
    lastCandleTime?: DateTime;
  }> {
    try {
      const ch = getClickHouseClient();
      const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

      let query = `
        SELECT 
          avg(volume) as avg_volume,
          avg(close) as avg_price,
          max(timestamp) as last_candle_time
        FROM ${CLICKHOUSE_DATABASE}.ohlcv_candles
        WHERE token_address = '${mint.replace(/'/g, "''")}' AND chain = '${chain.replace(/'/g, "''")}'
      `;

      if (dateRange) {
        const startUnix = Math.floor(dateRange.start.toSeconds());
        const endUnix = Math.floor(dateRange.end.toSeconds());
        query += ` AND timestamp >= toDateTime(${startUnix}) AND timestamp <= toDateTime(${endUnix})`;
      }

      const result = await ch.query({
        query,
        format: 'JSONEachRow',
      });

      const data = (await result.json()) as Array<{
        avg_volume: number;
        avg_price: number;
        last_candle_time: string;
      }>;

      if (data.length === 0 || !data[0]) {
        return { avgVolume: 0, avgPrice: 0 };
      }

      const row = data[0];
      return {
        avgVolume: row.avg_volume || 0,
        avgPrice: row.avg_price || 0,
        lastCandleTime: row.last_candle_time
          ? DateTime.fromISO(row.last_candle_time)
          : undefined,
      };
    } catch (error: any) {
      logger.warn('Failed to get token stats', { error: error.message, mint: mint.substring(0, 20) });
      return { avgVolume: 0, avgPrice: 0 };
    }
  }

  /**
   * Check if token has calls from a specific caller
   */
  private async checkTokenHasCaller(
    mint: string,
    chain: string,
    caller: string,
    dateRange?: { start: DateTime; end: DateTime }
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(DB_PATH, (err) => {
        if (err) {
          logger.error('Error opening database', err as Error);
          return reject(err);
        }

        let query = `
          SELECT COUNT(*) as count
          FROM ca_calls
          WHERE mint = ? AND chain = ? AND caller = ?
        `;

        const params: any[] = [mint, chain, caller];

        if (dateRange) {
          const startUnix = Math.floor(dateRange.start.toSeconds());
          const endUnix = Math.floor(dateRange.end.toSeconds());
          query += ' AND call_timestamp >= ? AND call_timestamp <= ?';
          params.push(startUnix, endUnix);
        }

        db.get(query, params, (err, row: any) => {
          db.close();
          if (err) {
            logger.error('Error checking caller', err as Error);
            return reject(err);
          }
          resolve((row?.count || 0) > 0);
        });
      });
    });
  }

  /**
   * Get token count matching criteria
   */
  async getTokenCount(criteria: TokenFilterCriteria): Promise<number> {
    const tokens = await this.filterTokens({ ...criteria, limit: undefined });
    return tokens.length;
  }
}

// Export singleton instance
export const tokenFilterService = new TokenFilterService();

