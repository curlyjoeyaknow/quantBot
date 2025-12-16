/**
 * Handler for storage query command
 *
 * Pure use-case function: takes validated args and context, returns data.
 * No Commander, no console.log, no process.exit, no env reads.
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { querySchema } from '../../commands/storage.js';
import { queryPostgresTable, queryClickHouseTable, SAFE_TABLES } from '../../commands/storage.js';

/**
 * Input arguments (already validated by Zod)
 */
export type QueryStorageArgs = z.infer<typeof querySchema>;

/**
 * Handler function: pure use-case orchestration
 */
export async function queryStorageHandler(
  args: QueryStorageArgs,
  _ctx: CommandContext
): Promise<unknown[]> {
  const isClickHouse = SAFE_TABLES.clickhouse.includes(args.table.toLowerCase());
  if (isClickHouse) {
    return await queryClickHouseTable(args.table, args.limit);
  }
  return await queryPostgresTable(args.table, args.limit);
}
