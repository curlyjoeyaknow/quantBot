/**
 * Handler for storage stats workflow command
 *
 * Pure use-case function: takes validated args and context, calls workflow.
 */

import type { CommandContext } from '../../core/command-context.js';
import {
  getStorageStats,
  createStorageStatsContext,
  type GetStorageStatsSpec,
  type GetStorageStatsResult,
} from '@quantbot/workflows';

/**
 * Input arguments (already validated by Zod)
 */
export type StorageStatsWorkflowArgs = {
  source?: 'clickhouse' | 'duckdb' | 'all';
  includeTableSizes?: boolean;
  includeRowCounts?: boolean;
  includeDateRanges?: boolean;
  duckdbPath?: string;
  format?: 'json' | 'table' | 'csv';
};

interface TableStatsRow {
  storage: string;
  database?: string;
  path?: string;
  table: string;
  rowCount?: number;
  dateMin?: string;
  dateMax?: string;
  error?: string;
}

/**
 * Handler function: pure use-case orchestration
 */
export async function storageStatsWorkflowHandler(
  args: StorageStatsWorkflowArgs,
  ctx: CommandContext
): Promise<GetStorageStatsResult | TableStatsRow[]> {
  // Build workflow spec
  const spec: GetStorageStatsSpec = {
    source: args.source || 'all',
    includeTableSizes: args.includeTableSizes ?? true,
    includeRowCounts: args.includeRowCounts ?? true,
    includeDateRanges: args.includeDateRanges ?? true,
    duckdbPath: args.duckdbPath,
  };

  // Create workflow context with ClickHouse client from CommandContext
  const workflowContext = createStorageStatsContext({
    clickHouseClient: ctx.services.clickHouseClient(),
  });

  // Call workflow
  const result = await getStorageStats(spec, workflowContext);

  // If format is JSON, return raw object structure
  if (args.format === 'json') {
    return result;
  }

  // For table/CSV format, transform to array of rows
  const rows: TableStatsRow[] = [];

  // Add ClickHouse tables
  if (result.clickhouse) {
    for (const table of result.clickhouse.tables) {
      rows.push({
        storage: 'clickhouse',
        database: result.clickhouse.database,
        table: table.name,
        rowCount: table.rowCount,
        dateMin: table.dateRange?.min,
        dateMax: table.dateRange?.max,
        error: table.error,
      });
    }
  }

  // Add DuckDB tables
  if (result.duckdb) {
    for (const table of result.duckdb.tables) {
      rows.push({
        storage: 'duckdb',
        path: result.duckdb.path,
        table: table.name,
        rowCount: table.rowCount,
        error: table.error,
      });
    }
  }

  return rows;
}
