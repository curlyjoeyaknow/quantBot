/**
 * OhlcvDedupService - Deduplication and run management for OHLCV candles.
 *
 * Provides:
 * - Inline deduplication (OPTIMIZE after each batch)
 * - Post-batch deduplication (OPTIMIZE after run completion)
 * - Scheduled sweep (OPTIMIZE all tables/partitions)
 * - Rollback by run_id (DELETE candles from a faulty run)
 * - Faulty run detection (identify runs with high error/corruption rates)
 */

import { getClickHouseClient } from '../../clickhouse-client.js';
import { logger } from '@quantbot/utils';

export interface DedupResult {
  duplicatesRemoved: number;
  tablesProcessed: string[];
  duration: number;
}

export interface RollbackResult {
  candlesDeleted: number;
  tablesAffected: string[];
}

export interface FaultyRunReport {
  runId: string;
  issues: string[];
  affectedCandles: number;
  recommendation: 'rollback' | 'revalidate' | 'ignore';
}

export class OhlcvDedupService {
  private readonly CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

  // Supported interval tables
  private readonly INTERVAL_TABLES = ['ohlcv_candles_1m', 'ohlcv_candles_5m'];

  /**
   * Deduplicate inline (OPTIMIZE after each batch for specific interval).
   * Forces immediate merge of parts in ClickHouse.
   */
  async deduplicateInline(runId: string, interval: string): Promise<DedupResult> {
    const startTime = Date.now();
    const ch = getClickHouseClient();
    const tableName = this.getTableNameForInterval(interval);

    try {
      // OPTIMIZE FINAL forces merge of all parts
      await ch.query({
        query: `OPTIMIZE TABLE ${this.CLICKHOUSE_DATABASE}.${tableName} FINAL`,
      });

      const duration = Date.now() - startTime;

      logger.info('Inline deduplication completed', {
        runId,
        table: tableName,
        duration,
      });

      return {
        duplicatesRemoved: 0, // ClickHouse doesn't report this
        tablesProcessed: [tableName],
        duration,
      };
    } catch (error: unknown) {
      logger.error('Inline deduplication failed', error as Error, {
        runId,
        table: tableName,
      });
      throw error;
    }
  }

  /**
   * Deduplicate post-batch (OPTIMIZE all interval tables after run completion).
   */
  async deduplicatePostBatch(runId: string): Promise<DedupResult> {
    const startTime = Date.now();
    const ch = getClickHouseClient();
    const tablesProcessed: string[] = [];

    try {
      for (const table of this.INTERVAL_TABLES) {
        await ch.query({
          query: `OPTIMIZE TABLE ${this.CLICKHOUSE_DATABASE}.${table} FINAL`,
        });
        tablesProcessed.push(table);
      }

      const duration = Date.now() - startTime;

      logger.info('Post-batch deduplication completed', {
        runId,
        tablesProcessed,
        duration,
      });

      return {
        duplicatesRemoved: 0,
        tablesProcessed,
        duration,
      };
    } catch (error: unknown) {
      logger.error('Post-batch deduplication failed', error as Error, {
        runId,
        tablesProcessed,
      });
      throw error;
    }
  }

  /**
   * Deduplicate sweep (OPTIMIZE all tables, optionally filtered by age).
   */
  async deduplicateSweep(options?: {
    intervals?: string[];
    olderThan?: Date;
    dryRun?: boolean;
  }): Promise<DedupResult> {
    const startTime = Date.now();
    const ch = getClickHouseClient();
    const dryRun = options?.dryRun ?? false;

    // Determine which tables to process
    const tablesToProcess = options?.intervals
      ? options.intervals.map((i) => this.getTableNameForInterval(i))
      : this.INTERVAL_TABLES;

    const tablesProcessed: string[] = [];

    try {
      for (const table of tablesToProcess) {
        if (dryRun) {
          logger.info('[DRY RUN] Would optimize table', { table });
          tablesProcessed.push(table);
        } else {
          // Build partition filter if olderThan is specified
          let partitionClause = '';
          if (options?.olderThan) {
            const yearMonth = this.formatYearMonth(options.olderThan);
            partitionClause = ` PARTITION (${yearMonth})`;
          }

          await ch.query({
            query: `OPTIMIZE TABLE ${this.CLICKHOUSE_DATABASE}.${table}${partitionClause} FINAL`,
          });
          tablesProcessed.push(table);

          logger.info('Optimized table', { table, partitionClause });
        }
      }

      const duration = Date.now() - startTime;

      logger.info('Sweep deduplication completed', {
        tablesProcessed,
        duration,
        dryRun,
      });

      return {
        duplicatesRemoved: 0,
        tablesProcessed,
        duration,
      };
    } catch (error: unknown) {
      logger.error('Sweep deduplication failed', error as Error, {
        tablesProcessed,
      });
      throw error;
    }
  }

  /**
   * Rollback a run (DELETE all candles with matching ingestion_run_id).
   */
  async rollbackRun(runId: string): Promise<RollbackResult> {
    const ch = getClickHouseClient();
    const tablesAffected: string[] = [];
    let totalDeleted = 0;

    try {
      // For each interval table, delete candles with this run_id
      for (const table of this.INTERVAL_TABLES) {
        // First check if any candles exist for this run
        const countResult = await ch.query({
          query: `
            SELECT count() as count
            FROM ${this.CLICKHOUSE_DATABASE}.${table}
            WHERE ingestion_run_id = '${runId.replace(/'/g, "''")}'
          `,
          format: 'JSONEachRow',
        });

        const countData = (await countResult.json()) as Array<{ count: number }>;
        const count = countData[0]?.count ?? 0;

        if (count > 0) {
          // DELETE in ClickHouse
          await ch.query({
            query: `
              ALTER TABLE ${this.CLICKHOUSE_DATABASE}.${table}
              DELETE WHERE ingestion_run_id = '${runId.replace(/'/g, "''")}'
            `,
          });

          tablesAffected.push(table);
          totalDeleted += count;

          logger.info('Rolled back candles from table', {
            runId,
            table,
            candlesDeleted: count,
          });
        }
      }

      // Mark run as rolled_back in ohlcv_ingestion_runs
      await ch.query({
        query: `
          ALTER TABLE ${this.CLICKHOUSE_DATABASE}.ohlcv_ingestion_runs
          UPDATE status = 'rolled_back'
          WHERE run_id = '${runId.replace(/'/g, "''")}'
        `,
      });

      logger.info('Rollback completed', {
        runId,
        tablesAffected,
        candlesDeleted: totalDeleted,
      });

      return {
        candlesDeleted: totalDeleted,
        tablesAffected,
      };
    } catch (error: unknown) {
      logger.error('Rollback failed', error as Error, {
        runId,
        tablesAffected,
      });
      throw error;
    }
  }

  /**
   * Identify faulty runs based on error rates and corruption metrics.
   */
  async identifyFaultyRuns(options?: {
    minErrorRate?: number;
    minZeroVolumeRate?: number;
    checkConsistency?: boolean;
  }): Promise<FaultyRunReport[]> {
    const ch = getClickHouseClient();
    const minErrorRate = options?.minErrorRate ?? 0.1; // 10%
    const minZeroVolumeRate = options?.minZeroVolumeRate ?? 0.5; // 50%

    try {
      // Query runs with high error rates or zero-volume rates
      const result = await ch.query({
        query: `
          SELECT
            run_id,
            status,
            candles_fetched,
            candles_inserted,
            candles_rejected,
            errors_count,
            zero_volume_count,
            error_message
          FROM ${this.CLICKHOUSE_DATABASE}.ohlcv_ingestion_runs
          WHERE status IN ('completed', 'failed')
            AND started_at >= now() - INTERVAL 30 DAY
          ORDER BY started_at DESC
        `,
        format: 'JSONEachRow',
      });

      const data = (await result.json()) as Array<{
        run_id: string;
        status: string;
        candles_fetched: number;
        candles_inserted: number;
        candles_rejected: number;
        errors_count: number;
        zero_volume_count: number;
        error_message: string | null;
      }>;

      const faultyRuns: FaultyRunReport[] = [];

      for (const row of data) {
        const issues: string[] = [];
        let recommendation: 'rollback' | 'revalidate' | 'ignore' = 'ignore';

        // Check error rate
        if (row.candles_fetched > 0) {
          const errorRate = row.errors_count / row.candles_fetched;
          if (errorRate >= minErrorRate) {
            issues.push(`High error rate: ${(errorRate * 100).toFixed(2)}%`);
            recommendation = 'rollback';
          }
        }

        // Check zero-volume rate
        if (row.candles_inserted > 0) {
          const zeroVolumeRate = row.zero_volume_count / row.candles_inserted;
          if (zeroVolumeRate >= minZeroVolumeRate) {
            issues.push(`High zero-volume rate: ${(zeroVolumeRate * 100).toFixed(2)}%`);
            recommendation = 'revalidate';
          }
        }

        // Check rejection rate
        if (row.candles_fetched > 0) {
          const rejectionRate = row.candles_rejected / row.candles_fetched;
          if (rejectionRate >= 0.3) {
            issues.push(`High rejection rate: ${(rejectionRate * 100).toFixed(2)}%`);
            recommendation = 'revalidate';
          }
        }

        // Failed runs should be investigated
        if (row.status === 'failed') {
          issues.push(`Run failed: ${row.error_message || 'Unknown error'}`);
          recommendation = 'rollback';
        }

        if (issues.length > 0) {
          faultyRuns.push({
            runId: row.run_id,
            issues,
            affectedCandles: row.candles_inserted,
            recommendation,
          });
        }
      }

      logger.info('Identified faulty runs', {
        faultyCount: faultyRuns.length,
        totalRuns: data.length,
      });

      return faultyRuns;
    } catch (error: unknown) {
      logger.error('Failed to identify faulty runs', error as Error);
      return [];
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
      throw new Error(`Unknown interval: ${interval}. Supported: ${Object.keys(mapping).join(', ')}`);
    }

    return table;
  }

  /**
   * Format date as YYYYMM for partition filtering.
   */
  private formatYearMonth(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}${month}`;
  }
}

