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
): Promise<Record<string, unknown>> {
  const stats: Record<string, unknown> = {};

  // PostgreSQL removed - no postgres stats
  stats.postgres = { error: 'PostgreSQL removed - use DuckDB instead' };

  // ClickHouse stats - use factory to get client
  try {
    const client = ctx.services.clickHouseClient();
    const database = process.env.CLICKHOUSE_DATABASE || 'quantbot';
    const tables = SAFE_TABLES.clickhouse;
    const counts: Record<string, number> = {};

    for (const table of tables) {
      const result = await client.query({
        query: `SELECT COUNT(*) as count FROM ${database}.${table}`,
        format: 'JSONEachRow',
      });
      const data = (await result.json()) as { count: string }[];
      const firstRow = data[0];
      counts[table] = firstRow ? parseInt(firstRow.count, 10) : 0;
    }

    stats.clickhouse = counts;
  } catch (error) {
    stats.clickhouse = { error: (error as Error).message };
  }

  return stats;
}
