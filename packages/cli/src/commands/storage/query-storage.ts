/**
 * CLI Composition Root for Storage Query
 *
 * This is a composition root - it's allowed to:
 * - Read process.env
 * - Do I/O
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { querySchema } from '../../commands/storage.js';
import { SAFE_TABLES } from '../../commands/storage.js';
import { ValidationError } from '@quantbot/utils';
import process from 'node:process';

/**
 * Input arguments (already validated by Zod)
 */
export type QueryStorageArgs = z.infer<typeof querySchema>;

/**
 * CLI handler for storage query
 *
 * This function can:
 * - Read process.env ✅
 * - Do I/O ✅
 */
export async function queryStorageHandler(
  args: QueryStorageArgs,
  ctx: CommandContext
): Promise<unknown[]> {
  const normalizedTable = args.table.toLowerCase();
  const isClickHouse = SAFE_TABLES.clickhouse.includes(normalizedTable);

  if (isClickHouse) {
    // Use factory to get ClickHouse client
    const client = ctx.services.clickHouseClient();

    // ENV LIVE HERE (composition root)
    const database = process.env.CLICKHOUSE_DATABASE || 'quantbot';

    // Validate table name
    if (!SAFE_TABLES.clickhouse.includes(normalizedTable)) {
      throw new ValidationError(
        `Invalid table name: ${args.table}. Allowed tables: ${SAFE_TABLES.clickhouse.join(', ')}`,
        { table: args.table, database: 'clickhouse', allowedTables: SAFE_TABLES.clickhouse }
      );
    }

    const query = `SELECT * FROM ${database}.${normalizedTable} LIMIT ${args.limit || 100}`;
    const result = await client.query(query);
    const rows = (await result.json()) as unknown[];

    return rows;
  } else {
    throw new ValidationError(
      `Unsupported table: ${args.table}. Only ClickHouse tables are supported.`,
      { table: args.table, supportedDatabases: ['clickhouse'] }
    );
  }
}
