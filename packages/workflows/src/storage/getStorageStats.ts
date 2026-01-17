/**
 * Storage Stats Workflow
 *
 * Gets comprehensive statistics from ClickHouse and DuckDB storage systems.
 * Follows workflow contract: validates spec, uses WorkflowContext, returns JSON-serializable results.
 */

import { z } from 'zod';
import { DateTime } from 'luxon';
import { ConfigurationError } from '@quantbot/infra/utils';
import type { WorkflowContextWithPorts } from '../context/workflowContextWithPorts.js';

/**
 * Storage stats spec
 */
export const GetStorageStatsSpecSchema = z.object({
  source: z.enum(['clickhouse', 'duckdb', 'all']).default('all'),
  includeTableSizes: z.boolean().default(true),
  includeRowCounts: z.boolean().default(true),
  includeDateRanges: z.boolean().default(true),
  duckdbPath: z.string().optional(),
});

export type GetStorageStatsSpec = z.infer<typeof GetStorageStatsSpecSchema>;

/**
 * Storage stats result
 */
export type GetStorageStatsResult = {
  source: 'clickhouse' | 'duckdb' | 'all';
  timestamp: string; // ISO string
  clickhouse?: {
    database: string;
    tables: Array<{
      name: string;
      rowCount?: number;
      dateRange?: {
        min: string; // ISO string
        max: string; // ISO string
      };
      error?: string;
    }>;
  };
  duckdb?: {
    path: string;
    tables: Array<{
      name: string;
      rowCount?: number;
      error?: string;
    }>;
  };
  summary: {
    totalTables: number;
    totalRows: number;
    errors: number;
  };
};

/**
 * Extended context for storage stats
 * Uses ports for all external dependencies
 */
export type StorageStatsContext = WorkflowContextWithPorts & {
  logger: {
    info: (message: string, context?: unknown) => void;
    warn: (message: string, context?: unknown) => void;
    error: (message: string, context?: unknown) => void;
    debug?: (message: string, context?: unknown) => void;
  };
  clock: {
    nowISO: () => string;
  };
  duckdb?: {
    query: (dbPath: string, query: string) => Promise<Array<Record<string, unknown>>>;
  };
};

/**
 * Get storage statistics workflow
 */
export async function getStorageStats(
  spec: GetStorageStatsSpec,
  ctx: StorageStatsContext = createDefaultStorageStatsContext()
): Promise<GetStorageStatsResult> {
  const validated = GetStorageStatsSpecSchema.parse(spec);
  const timestamp = ctx.clock.nowISO();
  const result: GetStorageStatsResult = {
    source: validated.source,
    timestamp,
    summary: {
      totalTables: 0,
      totalRows: 0,
      errors: 0,
    },
  };

  const database = process.env.CLICKHOUSE_DATABASE || 'quantbot';

  // ClickHouse stats
  if (validated.source === 'clickhouse' || validated.source === 'all') {
    try {
      const tables = [
        'ohlcv_candles',
        'indicator_values',
        'simulation_events',
        'simulation_aggregates',
        'token_metadata',
      ];

      const tableStats: GetStorageStatsResult['clickhouse'] = {
        database,
        tables: [],
      };

      for (const table of tables) {
        try {
          const tableStat: {
            name: string;
            rowCount?: number;
            dateRange?: { min: string; max: string };
            error?: string;
          } = { name: table };

          // Row count
          if (validated.includeRowCounts) {
            const countResult = await ctx.ports.query.query({
              query: `SELECT COUNT(*) as count FROM ${database}.${table}`,
              format: 'JSONEachRow',
            });
            const count = (countResult.rows[0] as Record<string, unknown>)?.['count'];
            if (typeof count === 'string') {
              tableStat.rowCount = parseInt(count, 10);
            } else if (typeof count === 'number') {
              tableStat.rowCount = count;
            }
          }

          // Date range (if table has timestamp column)
          if (validated.includeDateRanges) {
            const timestampColumns = ['timestamp', 'event_time', 'created_at'];
            for (const col of timestampColumns) {
              try {
                const rangeResult = await ctx.ports.query.query({
                  query: `SELECT MIN(${col}) as min, MAX(${col}) as max FROM ${database}.${table} WHERE ${col} IS NOT NULL`,
                  format: 'JSONEachRow',
                });
                const min = (rangeResult.rows[0] as Record<string, unknown>)?.['min'];
                const max = (rangeResult.rows[0] as Record<string, unknown>)?.['max'];
                if (min && max) {
                  tableStat.dateRange = {
                    min:
                      typeof min === 'string' ? min : DateTime.fromSeconds(min as number).toISO()!,
                    max:
                      typeof max === 'string' ? max : DateTime.fromSeconds(max as number).toISO()!,
                  };
                  break; // Found a timestamp column, stop looking
                }
              } catch {
                // Column doesn't exist, try next
                continue;
              }
            }
          }

          tableStats.tables.push(tableStat);
          if (tableStat.rowCount) {
            result.summary.totalRows += tableStat.rowCount;
          }
        } catch (error) {
          result.summary.errors++;
          tableStats.tables.push({
            name: table,
            error: (error as Error).message,
          });
        }
      }

      result.clickhouse = tableStats;
      result.summary.totalTables += tableStats.tables.length;
    } catch (error) {
      ctx.logger.error('Failed to get ClickHouse stats', error as Error);
      result.clickhouse = {
        database,
        tables: [{ name: 'error', error: (error as Error).message }],
      };
      result.summary.errors++;
    }
  }

  // DuckDB stats
  if ((validated.source === 'duckdb' || validated.source === 'all') && ctx.duckdb?.query) {
    try {
      const dbPath = validated.duckdbPath || process.env.DUCKDB_PATH || 'data/tele.duckdb';
      const tables = ['strategies', 'callers', 'token_data', 'simulation_runs'];

      const tableStats: GetStorageStatsResult['duckdb'] = {
        path: dbPath,
        tables: [],
      };

      for (const table of tables) {
        try {
          const tableStat: { name: string; rowCount?: number; error?: string } = { name: table };

          if (validated.includeRowCounts && ctx.duckdb) {
            const countResult = await ctx.duckdb.query(
              dbPath,
              `SELECT COUNT(*) as count FROM ${table}`
            );
            const count = countResult[0]?.['count'];
            if (typeof count === 'number') {
              tableStat.rowCount = count;
            } else if (typeof count === 'string') {
              tableStat.rowCount = parseInt(count, 10);
            }
          }

          tableStats.tables.push(tableStat);
          if (tableStat.rowCount) {
            result.summary.totalRows += tableStat.rowCount;
          }
        } catch (error) {
          result.summary.errors++;
          tableStats.tables.push({
            name: table,
            error: (error as Error).message,
          });
        }
      }

      result.duckdb = tableStats;
      result.summary.totalTables += tableStats.tables.length;
    } catch (error) {
      ctx.logger.error('Failed to get DuckDB stats', error as Error);
      result.duckdb = {
        path: validated.duckdbPath || 'unknown',
        tables: [{ name: 'error', error: (error as Error).message }],
      };
      result.summary.errors++;
    }
  }

  return result;
}

/**
 * Create default context for testing
 */
function createDefaultStorageStatsContext(): StorageStatsContext {
  throw new ConfigurationError(
    'StorageStatsContext must be provided - no default implementation',
    'StorageStatsContext',
    { operation: 'getStorageStats' }
  );
}
