/**
 * Handler: Analyze duplicate candles in ClickHouse
 *
 * Identifies tokens with duplicate candles (same token, timestamp, interval)
 * and provides options to deduplicate based on most recent ingestion.
 */

import type { CommandContext } from '../../core/command-context.js';
import { logger } from '@quantbot/utils';
import { getClickHouseClient } from '@quantbot/storage';
import { DateTime } from 'luxon';

export interface AnalyzeDuplicateCandlesArgs {
  limit?: number;
  token?: string;
  chain?: string;
  interval?: string;
  showDetails?: boolean;
  format?: 'json' | 'table';
}

export interface DuplicateGroup {
  tokenAddress: string;
  chain: string;
  interval: string;
  timestamp: string;
  duplicateCount: number;
  ingestionTimes: string[];
}

export interface TokenDuplicateSummary {
  tokenAddress: string;
  chain: string;
  duplicateTimestamps: number;
  extraRows: number;
}

export interface AnalyzeDuplicateCandlesResult {
  success: boolean;
  totalDuplicateGroups: number;
  totalExtraRows: number;
  duplicateGroups: DuplicateGroup[];
  tokenSummaries: TokenDuplicateSummary[];
  error?: string;
}

export async function analyzeDuplicateCandlesHandler(
  args: AnalyzeDuplicateCandlesArgs,
  _ctx: CommandContext
): Promise<AnalyzeDuplicateCandlesResult> {
  const limit = args.limit || 100;
  const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

  try {
    const ch = getClickHouseClient();

    // Build WHERE clause for filtering
    const filters: string[] = [];
    if (args.token) {
      filters.push(`token_address = '${args.token.replace(/'/g, "''")}'`);
    }
    if (args.chain) {
      filters.push(`chain = '${args.chain.replace(/'/g, "''")}'`);
    }
    if (args.interval) {
      filters.push(`interval = '${args.interval.replace(/'/g, "''")}'`);
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

    // Query for duplicate candles
    const duplicatesQuery = `
      SELECT 
        token_address,
        chain,
        interval,
        timestamp,
        count() as duplicate_count,
        groupArray(ingested_at) as ingestion_times
      FROM ${CLICKHOUSE_DATABASE}.ohlcv_candles
      ${whereClause}
      GROUP BY token_address, chain, interval, timestamp
      HAVING duplicate_count > 1
      ORDER BY duplicate_count DESC, token_address, timestamp
      LIMIT ${limit}
    `;

    logger.debug('Querying for duplicate candles', { query: duplicatesQuery });

    const duplicatesResult = await ch.query({
      query: duplicatesQuery,
      format: 'JSONEachRow',
    });

    const duplicatesData = (await duplicatesResult.json()) as Array<{
      token_address: string;
      chain: string;
      interval: string;
      timestamp: string;
      duplicate_count: number;
      ingestion_times: string[];
    }>;

    // Query for token summaries
    const summaryQuery = `
      SELECT 
        token_address,
        chain,
        count(DISTINCT timestamp) as duplicate_timestamps,
        sum(cnt - 1) as extra_rows
      FROM (
        SELECT 
          token_address,
          chain,
          timestamp,
          count() as cnt
        FROM ${CLICKHOUSE_DATABASE}.ohlcv_candles
        ${whereClause}
        GROUP BY token_address, chain, timestamp
        HAVING cnt > 1
      )
      GROUP BY token_address, chain
      ORDER BY extra_rows DESC
      LIMIT ${limit}
    `;

    logger.debug('Querying for token summaries', { query: summaryQuery });

    const summaryResult = await ch.query({
      query: summaryQuery,
      format: 'JSONEachRow',
    });

    const summaryData = (await summaryResult.json()) as Array<{
      token_address: string;
      chain: string;
      duplicate_timestamps: number;
      extra_rows: number;
    }>;

    // Calculate totals
    const totalDuplicateGroups = duplicatesData.length;
    const totalExtraRows = summaryData.reduce((sum, row) => sum + row.extra_rows, 0);

    // Format results
    const duplicateGroups: DuplicateGroup[] = duplicatesData.map((row) => ({
      tokenAddress: row.token_address,
      chain: row.chain,
      interval: row.interval,
      timestamp: row.timestamp,
      duplicateCount: row.duplicate_count,
      ingestionTimes: row.ingestion_times.map((t) => {
        try {
          return DateTime.fromISO(t).toISO() || t;
        } catch {
          return t;
        }
      }),
    }));

    const tokenSummaries: TokenDuplicateSummary[] = summaryData.map((row) => ({
      tokenAddress: row.token_address,
      chain: row.chain,
      duplicateTimestamps: row.duplicate_timestamps,
      extraRows: row.extra_rows,
    }));

    logger.info('Duplicate candles analysis complete', {
      totalDuplicateGroups,
      totalExtraRows,
      tokenCount: tokenSummaries.length,
    });

    return {
      success: true,
      totalDuplicateGroups,
      totalExtraRows,
      duplicateGroups,
      tokenSummaries,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to analyze duplicate candles', error as Error);

    return {
      success: false,
      totalDuplicateGroups: 0,
      totalExtraRows: 0,
      duplicateGroups: [],
      tokenSummaries: [],
      error: errorMessage,
    };
  }
}
