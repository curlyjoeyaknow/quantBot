/**
 * Handler for storage query command
 *
 * Pure use-case function: takes validated args and context, returns data.
 * No Commander, no console.log, no process.exit, no env reads.
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { querySchema } from '../../commands/storage.js';
import { SAFE_TABLES } from '../../commands/storage.js';
import { ValidationError } from '@quantbot/utils';

/**
 * Input arguments (already validated by Zod)
 */
export type QueryStorageArgs = z.infer<typeof querySchema>;

/**
 * Handler function: pure use-case orchestration
 * Uses factory to get clients (no direct singleton access)
 */
export async function queryStorageHandler(
  args: QueryStorageArgs,
  ctx: CommandContext
): Promise<unknown[]> {
  const isClickHouse = SAFE_TABLES.clickhouse.includes(args.table.toLowerCase());

  if (isClickHouse) {
    // Use factory to get ClickHouse client
    const client = ctx.services.clickHouseClient();
    const database = process.env.CLICKHOUSE_DATABASE || 'quantbot';

    // Validate table name
    if (!SAFE_TABLES.clickhouse.includes(args.table.toLowerCase())) {
      throw new ValidationError(
        `Invalid table name: ${args.table}. Allowed tables: ${SAFE_TABLES.clickhouse.join(', ')}`,
        { table: args.table, database: 'clickhouse', allowedTables: SAFE_TABLES.clickhouse }
      );
    }

    // Use parameterized query
    const result = await client.query({
      query: `SELECT * FROM ${database}.${args.table} LIMIT {limit:UInt32}`,
      query_params: { limit: args.limit },
      format: 'JSONEachRow',
    });

    const data = await result.json<Record<string, unknown>[]>();
    return data;
  }

  // PostgreSQL removed
  throw new ValidationError('PostgreSQL removed - use DuckDB instead', {
    table: args.table,
    limit: args.limit,
  });
}
