/**
 * Export Lab Calls to Parquet Handler
 *
 * Exports calls from DuckDB to Parquet format for efficient parallel processing.
 * Creates per-caller Parquet files and a combined file, plus a manifest.
 */

import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { DateTime } from 'luxon';
import type { CommandContext } from '../../core/command-context.js';
import type { LabExportParquetArgs } from '../../command-defs/lab.js';
import { DuckDBClient } from '@quantbot/storage';
import { ValidationError } from '@quantbot/infra/utils';

export interface ParquetManifest {
  version: string;
  exportedAt: string;
  duckdbPath: string;
  from?: string;
  to?: string;
  caller?: string;
  mint?: string;
  callers: Array<{
    name: string;
    file: string;
    count: number;
  }>;
  totalCalls: number;
  combinedFile: string;
}

/**
 * Convert DuckDB call to CallSignal-like format for Parquet export
 */
function convertCallToRow(call: {
  mint: string;
  alert_timestamp: string;
  caller_name?: string | null;
  price_usd?: number | null;
}): Record<string, unknown> {
  const alertTimestamp = DateTime.fromISO(call.alert_timestamp);
  const tsMs = alertTimestamp.toMillis();

  return {
    mint: call.mint,
    alert_ts_ms: tsMs,
    alert_timestamp: call.alert_timestamp,
    caller_name: call.caller_name || 'unknown',
    price_usd: call.price_usd || null,
  };
}

export async function exportLabParquetHandler(
  args: LabExportParquetArgs,
  ctx: CommandContext
): Promise<{ success: boolean; outputDir: string; manifest: ParquetManifest }> {
  const duckdbStorage = ctx.services.duckdbStorage();
  const dbPath = args.duckdb || process.env.DUCKDB_PATH || 'data/tele.duckdb';
  const fromDate = args.from ? DateTime.fromISO(args.from) : undefined;
  const toDate = args.to ? DateTime.fromISO(args.to) : undefined;

  // Ensure output directory exists
  await mkdir(args.out, { recursive: true });

  // Query calls from DuckDB (get all, we'll filter and group)
  const callsResult = await duckdbStorage.queryCalls(
    dbPath,
    args.limit || 100000, // Large limit for export
    false, // excludeUnrecoverable
    args.caller,
    fromDate?.toMillis(),
    toDate?.toMillis()
  );

  if (!callsResult.success || !callsResult.calls) {
    throw new ValidationError(
      `Failed to query calls from DuckDB: ${callsResult.error || 'Unknown error'}`,
      { dbPath, args }
    );
  }

  // Filter by mint if specified
  let calls = callsResult.calls;
  if (args.mint) {
    calls = calls.filter((call) => call.mint === args.mint);
  }

  if (calls.length === 0) {
    throw new ValidationError('No calls found matching criteria', { args });
  }

  // Group calls by caller to get caller list
  const callers = new Set<string>();
  for (const call of calls) {
    callers.add(call.caller_name || 'unknown');
  }

  // Export per-caller Parquet files using DuckDB SQL
  const callerFiles: Array<{ name: string; file: string; count: number }> = [];

  // Build WHERE clause for filtering
  const whereConditions: string[] = [];
  if (args.caller) {
    whereConditions.push(`COALESCE(caller_name_norm, caller_raw_name) = '${args.caller.replace(/'/g, "''")}'`);
  }
  if (args.mint) {
    whereConditions.push(`mint = '${args.mint.replace(/'/g, "''")}'`);
  }
  if (fromDate) {
    whereConditions.push(`alert_ts_ms >= ${fromDate.toMillis()}`);
  }
  if (toDate) {
    whereConditions.push(`alert_ts_ms <= ${toDate.toMillis()}`);
  }
  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  // Export per-caller Parquet files using DuckDB SQL
  const sourceDuckdb = new DuckDBClient(dbPath);
  for (const callerName of callers) {
    const safeCallerName = callerName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `calls_caller=${safeCallerName}.parquet`;
    const filePath = join(args.out, fileName);

    // Export using COPY TO PARQUET directly from source database
    const callerWhere = `${whereClause ? whereClause + ' AND' : 'WHERE'} COALESCE(caller_name_norm, caller_raw_name) = '${callerName.replace(/'/g, "''")}'`;
    await sourceDuckdb.execute(`
      COPY (
        SELECT 
          mint,
          alert_ts_ms,
          CAST(alert_ts_ms AS TIMESTAMP) AS alert_timestamp,
          COALESCE(caller_name_norm, caller_raw_name) AS caller_name,
          NULL AS price_usd
        FROM canon.alerts_std
        ${callerWhere}
        ORDER BY alert_ts_ms DESC
        ${args.limit ? `LIMIT ${args.limit}` : ''}
      ) TO '${filePath.replace(/'/g, "''")}' (FORMAT PARQUET)
    `);

    // Get count
    const countResult = await sourceDuckdb.query(`
      SELECT COUNT(*) as cnt FROM canon.alerts_std ${callerWhere}
    `);
    const count = countResult.rows?.[0]?.[0] || 0;

    callerFiles.push({
      name: callerName,
      file: fileName,
      count: Number(count),
    });
  }

  // Export combined file
  const combinedFileName = 'calls_all.parquet';
  const combinedFilePath = join(args.out, combinedFileName);

  await sourceDuckdb.execute(`
    COPY (
      SELECT 
        mint,
        alert_ts_ms,
        CAST(alert_ts_ms AS TIMESTAMP) AS alert_timestamp,
        COALESCE(caller_name_norm, caller_raw_name) AS caller_name,
        NULL AS price_usd
      FROM canon.alerts_std
      ${whereClause}
      ORDER BY alert_ts_ms DESC
      ${args.limit ? `LIMIT ${args.limit}` : ''}
    ) TO '${combinedFilePath.replace(/'/g, "''")}' (FORMAT PARQUET)
  `);

  // Write manifest
  const manifest: ParquetManifest = {
    version: '1.0.0',
    exportedAt: DateTime.utc().toISO()!,
    duckdbPath: dbPath,
    from: args.from,
    to: args.to,
    caller: args.caller,
    mint: args.mint,
    callers: callerFiles,
    totalCalls: calls.length,
    combinedFile: combinedFileName,
  };

  const manifestPath = join(args.out, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  return {
    success: true,
    outputDir: args.out,
    manifest,
  };
}

