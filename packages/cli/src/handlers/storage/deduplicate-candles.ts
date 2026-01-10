/**
 * Handler: Deduplicate candles in ClickHouse
 *
 * Removes duplicate candles, keeping only the most recent ingestion
 * for each (token_address, chain, timestamp, interval) combination.
 */

import type { CommandContext } from '../../core/command-context.js';
import { logger } from '@quantbot/utils';
import { getClickHouseClient } from '@quantbot/storage';

export interface DeduplicateCandlesArgs {
  token?: string;
  chain?: string;
  interval?: string;
  dryRun?: boolean;
  batchSize?: number;
}

export interface DeduplicateCandlesResult {
  success: boolean;
  rowsDeleted: number;
  dryRun: boolean;
  error?: string;
}

export async function deduplicateCandlesHandler(
  args: DeduplicateCandlesArgs,
  _ctx: CommandContext
): Promise<DeduplicateCandlesResult> {
  const dryRun = args.dryRun ?? true; // Default to dry run for safety
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

    const whereClause = filters.length > 0 ? `AND ${filters.join(' AND ')}` : '';

    // Strategy: Use ALTER TABLE DELETE to remove duplicates
    // Keep only the row with the most recent ingested_at for each group
    const deleteQuery = `
      ALTER TABLE ${CLICKHOUSE_DATABASE}.ohlcv_candles
      DELETE WHERE (token_address, chain, timestamp, interval, ingested_at) IN (
        SELECT 
          token_address,
          chain,
          timestamp,
          interval,
          ingested_at
        FROM ${CLICKHOUSE_DATABASE}.ohlcv_candles
        WHERE (token_address, chain, timestamp, interval) IN (
          SELECT token_address, chain, timestamp, interval
          FROM ${CLICKHOUSE_DATABASE}.ohlcv_candles
          ${whereClause}
          GROUP BY token_address, chain, timestamp, interval
          HAVING count() > 1
        )
        ${whereClause}
        AND ingested_at < (
          SELECT max(ingested_at)
          FROM ${CLICKHOUSE_DATABASE}.ohlcv_candles AS t2
          WHERE t2.token_address = ${CLICKHOUSE_DATABASE}.ohlcv_candles.token_address
            AND t2.chain = ${CLICKHOUSE_DATABASE}.ohlcv_candles.chain
            AND t2.timestamp = ${CLICKHOUSE_DATABASE}.ohlcv_candles.timestamp
            AND t2.interval = ${CLICKHOUSE_DATABASE}.ohlcv_candles.interval
        )
      )
    `;

    if (dryRun) {
      logger.info('[DRY RUN] Would execute deduplication query', {
        query: deleteQuery,
      });

      // Count how many rows would be deleted
      const countQuery = `
        SELECT count() as count
        FROM ${CLICKHOUSE_DATABASE}.ohlcv_candles
        WHERE (token_address, chain, timestamp, interval) IN (
          SELECT token_address, chain, timestamp, interval
          FROM ${CLICKHOUSE_DATABASE}.ohlcv_candles
          ${whereClause}
          GROUP BY token_address, chain, timestamp, interval
          HAVING count() > 1
        )
        ${whereClause}
        AND ingested_at < (
          SELECT max(ingested_at)
          FROM ${CLICKHOUSE_DATABASE}.ohlcv_candles AS t2
          WHERE t2.token_address = ${CLICKHOUSE_DATABASE}.ohlcv_candles.token_address
            AND t2.chain = ${CLICKHOUSE_DATABASE}.ohlcv_candles.chain
            AND t2.timestamp = ${CLICKHOUSE_DATABASE}.ohlcv_candles.timestamp
            AND t2.interval = ${CLICKHOUSE_DATABASE}.ohlcv_candles.interval
        )
      `;

      const countResult = await ch.query({
        query: countQuery,
        format: 'JSONEachRow',
      });

      const countData = (await countResult.json()) as Array<{ count: number }>;
      const rowsToDelete = countData[0]?.count || 0;

      logger.info('[DRY RUN] Deduplication would delete rows', {
        rowsToDelete,
      });

      return {
        success: true,
        rowsDeleted: rowsToDelete,
        dryRun: true,
      };
    }

    // Execute deduplication
    logger.info('Executing deduplication query', {
      filters: filters.length > 0 ? filters : 'none (all tokens)',
    });

    await ch.exec({
      query: deleteQuery,
    });

    logger.info('Deduplication complete', {
      message:
        'Deleted duplicate candles (kept most recent ingestion). Note: ClickHouse DELETE is async.',
    });

    // Note: ClickHouse DELETE is asynchronous and may take time to complete
    // We can't get an exact count of deleted rows immediately
    return {
      success: true,
      rowsDeleted: -1, // Unknown due to async nature
      dryRun: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to deduplicate candles', error as Error);

    return {
      success: false,
      rowsDeleted: 0,
      dryRun,
      error: errorMessage,
    };
  }
}
