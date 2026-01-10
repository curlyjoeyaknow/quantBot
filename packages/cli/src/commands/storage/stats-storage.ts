/**
 * CLI Composition Root for Storage Stats
 *
 * This is a composition root - it's allowed to:
 * - Read process.env
 * - Do I/O
 */

import type { CommandContext } from '../../core/command-context.js';
import { SAFE_TABLES } from '../../commands/storage.js';
import process from 'node:process';

/**
 * Input arguments (already validated by Zod)
 */
export type StatsStorageArgs = {
  format?: 'json' | 'table' | 'csv';
};

/**
 * CLI handler for storage stats
 *
 * This function can:
 * - Read process.env ✅
 * - Do I/O ✅
 */
export async function statsStorageHandler(
  _args: StatsStorageArgs,
  ctx: CommandContext
): Promise<Record<string, unknown> | Array<Record<string, unknown>>> {
  // ClickHouse stats - use factory to get client
  const client = ctx.services.clickHouseClient();

  // ENV LIVE HERE (composition root)
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
        storage: 'clickhouse',
        database: 'clickhouse',
        table,
        count,
      });
    } catch (error) {
      // Skip tables that don't exist (test expectation)
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("doesn't exist") || errorMessage.includes('does not exist')) {
        // Skip non-existent tables
        continue;
      }
      // Include other errors
      rows.push({
        storage: 'clickhouse',
        database: 'clickhouse',
        table,
        count: 0,
        error: errorMessage,
      });
    }
  }

  return rows;
}
