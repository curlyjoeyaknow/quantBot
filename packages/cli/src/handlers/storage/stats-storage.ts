/**
 * Handler for storage stats command
 *
 * Pure use-case function: takes validated args and context, returns data.
 * No Commander, no console.log, no process.exit, no env reads.
 */

import type { CommandContext } from '../../core/command-context.js';
import { SAFE_TABLES } from '../../commands/storage.js';
// PostgreSQL removed - getPostgresPool no longer available

/**
 * Input arguments (already validated by Zod)
 */
export type StatsStorageArgs = {
  format?: 'json' | 'table' | 'csv';
};

/**
 * Handler function: pure use-case orchestration
 */
export async function statsStorageHandler(
  _args: StatsStorageArgs,
  ctx: CommandContext
): Promise<Record<string, unknown> | Array<Record<string, unknown>>> {
  // ClickHouse stats - use factory to get client
  const client = ctx.services.clickHouseClient();
  const database = process.env.CLICKHOUSE_DATABASE || 'quantbot';
  const tables = SAFE_TABLES.clickhouse;
  const rows: Array<Record<string, unknown>> = [];

  for (const table of tables) {
    try {
      const result = await client.query({
        query: `SELECT COUNT(*) as count FROM ${database}.${table}`,
        format: 'JSONEachRow',
      });
      const data = (await result.json()) as { count: string }[];
      const firstRow = data[0];
      const count = firstRow ? parseInt(firstRow.count, 10) : 0;
      rows.push({
        table,
        count,
        storage: 'clickhouse',
      });
    } catch (error) {
      // Skip tables that don't exist, but log the error
      const errorMessage = (error as Error).message;
      if (errorMessage.includes("doesn't exist")) {
        // Table doesn't exist - skip it
        continue;
      }
      // For other errors, include in results
      rows.push({
        table,
        storage: 'clickhouse',
        error: errorMessage,
      });
    }
  }

  return rows;
}
