/**
 * Handler for storage stats command
 *
 * Pure use-case function: takes validated args and context, returns data.
 * No Commander, no console.log, no process.exit, no env reads.
 */

import type { CommandContext } from '../../core/command-context.js';
import { getPostgresPool, getClickHouseClient } from '@quantbot/storage';
import { SAFE_TABLES } from '../../commands/storage.js';

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
  _ctx: CommandContext
): Promise<Record<string, unknown>> {
  const stats: Record<string, unknown> = {};

  // Postgres stats
  try {
    const pool = getPostgresPool();
    const tables = SAFE_TABLES.postgres;
    const counts: Record<string, number> = {};

    for (const table of tables) {
      const result = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
      counts[table] = parseInt(result.rows[0]?.count ?? '0', 10);
    }

    stats.postgres = counts;
  } catch (error) {
    stats.postgres = { error: (error as Error).message };
  }

  // ClickHouse stats
  try {
    const client = getClickHouseClient();
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
