/**
 * Remove Faulty Addresses Handler
 *
 * Removes faulty addresses (truncated, invalid format) from DuckDB database
 */

import path from 'node:path';
import { ConfigurationError, logger } from '@quantbot/utils';
import type { CommandContext } from '../../core/command-context.js';
import { removeFaultyAddressesSchema } from '../../commands/storage.js';
import type { z } from 'zod';

export type RemoveFaultyAddressesArgs = z.infer<typeof removeFaultyAddressesSchema>;

export async function removeFaultyAddressesHandler(
  args: RemoveFaultyAddressesArgs,
  ctx: CommandContext
) {
  const duckdbPathRaw = args.duckdb || process.env.DUCKDB_PATH;
  if (!duckdbPathRaw) {
    throw new ConfigurationError(
      'DuckDB path is required. Provide --duckdb or set DUCKDB_PATH environment variable.',
      'duckdbPath',
      { args, env: { DUCKDB_PATH: process.env.DUCKDB_PATH } }
    );
  }
  const duckdbPath = path.resolve(duckdbPathRaw);

  const dryRun = args.dryRun || false;

  if (dryRun) {
    logger.info('DRY RUN: Would remove faulty addresses from DuckDB database', { duckdbPath });
  } else {
    logger.warn('Removing faulty addresses from DuckDB database', { duckdbPath });
  }

  const duckdbStorage = ctx.services.duckdbStorage();

  const result = await duckdbStorage.removeFaultyAddresses(duckdbPath, dryRun);

  if (!result.success) {
    throw new Error(`Failed to remove faulty addresses: ${result.error || 'Unknown error'}`);
  }

  if (dryRun) {
    logger.info('DRY RUN: Would delete rows', {
      total_rows: result.total_rows_deleted,
      tables: result.tables_affected,
    });
  } else {
    logger.info('Removed faulty addresses', {
      total_rows_deleted: result.total_rows_deleted,
      tables_affected: result.tables_affected,
    });
  }

  if (result.removals && result.removals.length > 0) {
    logger.info('Removed addresses', {
      count: result.removals.length,
      examples: result.removals.slice(0, 10).map((r) => ({
        mint: r.mint,
        table: r.table_name,
        rows: r.rows_deleted,
      })),
    });
  }

  return {
    success: true,
    duckdb: duckdbPath,
    dry_run: result.dry_run,
    total_rows_deleted: result.total_rows_deleted,
    tables_affected: result.tables_affected,
    removals: result.removals,
  };
}
