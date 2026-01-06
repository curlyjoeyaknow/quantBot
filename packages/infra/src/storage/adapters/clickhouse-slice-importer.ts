/**
 * ClickHouse Slice Importer - Insert Parquet files into ClickHouse
 *
 * Supports multiple deployment scenarios:
 * - Client-side bulk insert (read Parquet, convert to rows, use ch.insert())
 * - Local file: INSERT INTO table SELECT * FROM file('path', 'Parquet')
 * - S3: INSERT INTO table SELECT * FROM s3('s3://...', 'Parquet')
 *
 * Matches the existing insertCandles pattern using ch.insert() with JSONEachRow format.
 */

import { createReadStream } from 'fs';
import { getClickHouseClient } from '../clickhouse-client.js';
import { logger } from '../../utils/index.js';
import type { SliceManifestV1 } from '@quantbot/core';

const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

/**
 * Insert mode for Parquet files
 */
export type InsertMode = 'client' | 'local-file' | 's3';

/**
 * Options for inserting Parquet files
 */
export interface InsertParquetOptions {
  /**
   * Insert mode:
   * - 'client': Read Parquet file, convert to rows, use ch.insert() (matches existing pattern)
   * - 'local-file': Use ClickHouse file() function (requires file on server)
   * - 's3': Use ClickHouse s3() function (requires S3 access)
   */
  mode?: InsertMode;

  /**
   * For 'local-file' mode: path to Parquet file on ClickHouse server
   * For 's3' mode: S3 URI (e.g., 's3://bucket/path/file.parquet')
   * For 'client' mode: local path to Parquet file (will be read and inserted)
   */
  parquetPath: string;

  /**
   * Target table (defaults to ohlcv_candles)
   */
  table?: string;

  /**
   * Whether to skip errors and continue (default: false)
   */
  skipErrors?: boolean;
}

/**
 * Insert Parquet file into ClickHouse using client-side bulk insert
 * Matches the existing insertCandles pattern using ch.insert() with Parquet format
 */
async function insertParquetClient(
  parquetPath: string,
  table: string,
  skipErrors: boolean
): Promise<{ rowsInserted: number; errors: string[] }> {
  const ch = getClickHouseClient();
  const errors: string[] = [];

  try {
    // Use ClickHouse client's insert with Parquet format
    // The @clickhouse/client library supports Parquet format with streams
    // This matches the pattern: ch.insert() with format specification
    const stream = createReadStream(parquetPath);

    await ch.insert({
      table,
      values: stream,
      format: 'Parquet',
    });

    // Get row count from file stats (approximate)
    // The caller can provide the exact row count from the manifest
    // For now, we'll return 0 and let the caller use manifest.rowCount
    return { rowsInserted: 0, errors: [] };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (skipErrors) {
      errors.push(errorMessage);
      logger.warn('Failed to insert Parquet file (skipped)', {
        path: parquetPath,
        error: errorMessage,
      });
      return { rowsInserted: 0, errors };
    }
    logger.error('Failed to insert Parquet file', error as Error, {
      path: parquetPath,
      table,
    });
    throw error;
  }
}

/**
 * Insert Parquet file using ClickHouse file() function (local file on server)
 */
async function insertParquetLocalFile(
  parquetPath: string,
  table: string,
  skipErrors: boolean
): Promise<{ rowsInserted: number; errors: string[] }> {
  const ch = getClickHouseClient();
  const errors: string[] = [];

  try {
    // Escape path for SQL (replace single quotes)
    const escapedPath = parquetPath.replace(/'/g, "''");

    const query = `
      INSERT INTO ${table}
      SELECT 
        token_address,
        chain,
        timestamp,
        \`interval\`,
        open,
        high,
        low,
        close,
        volume
      FROM file('${escapedPath}', 'Parquet')
      SETTINGS format_parquet_import_nested = 1
    `;

    await ch.exec({ query });

    // Get row count from query result (if available)
    // For now, return 0 (caller can provide from manifest)
    return { rowsInserted: 0, errors: [] };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (skipErrors) {
      errors.push(errorMessage);
      logger.warn('Failed to insert Parquet file from local path (skipped)', {
        path: parquetPath,
        error: errorMessage,
      });
      return { rowsInserted: 0, errors };
    }
    logger.error('Failed to insert Parquet file from local path', error as Error, {
      path: parquetPath,
      table,
    });
    throw error;
  }
}

/**
 * Insert Parquet file using ClickHouse s3() function (S3 storage)
 */
async function insertParquetS3(
  s3Uri: string,
  table: string,
  skipErrors: boolean
): Promise<{ rowsInserted: number; errors: string[] }> {
  const ch = getClickHouseClient();
  const errors: string[] = [];

  try {
    // Escape S3 URI for SQL (replace single quotes)
    const escapedUri = s3Uri.replace(/'/g, "''");

    const query = `
      INSERT INTO ${table}
      SELECT 
        token_address,
        chain,
        timestamp,
        \`interval\`,
        open,
        high,
        low,
        close,
        volume
      FROM s3('${escapedUri}', 'Parquet')
      SETTINGS format_parquet_import_nested = 1
    `;

    await ch.exec({ query });

    // Get row count from query result (if available)
    // For now, return 0 (caller can provide from manifest)
    return { rowsInserted: 0, errors: [] };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (skipErrors) {
      errors.push(errorMessage);
      logger.warn('Failed to insert Parquet file from S3 (skipped)', {
        s3Uri,
        error: errorMessage,
      });
      return { rowsInserted: 0, errors };
    }
    logger.error('Failed to insert Parquet file from S3', error as Error, {
      s3Uri,
      table,
    });
    throw error;
  }
}

/**
 * Insert Parquet file(s) from a slice manifest into ClickHouse
 *
 * This is the main entry point for backfilling data from exported slices.
 * Matches the existing insertCandles pattern.
 */
export async function insertSqlForParquet(
  manifest: SliceManifestV1,
  options: InsertParquetOptions
): Promise<{
  filesProcessed: number;
  totalRowsInserted: number;
  errors: string[];
}> {
  const {
    mode = 'client',
    parquetPath,
    table = `${CLICKHOUSE_DATABASE}.ohlcv_candles`,
    skipErrors = false,
  } = options;

  const errors: string[] = [];
  let filesProcessed = 0;
  let totalRowsInserted = 0;

  // Determine which files to insert
  // Use parquetPath from options if provided, otherwise use files from manifest
  const filesToInsert = parquetPath
    ? [{ path: parquetPath.replace(/^file:\/\//, ''), rowCount: 0 }]
    : manifest.parquetFiles.map((f: { path: string; rowCount?: number }) => {
        const path = f.path.replace(/^file:\/\//, '');
        return {
          path,
          rowCount: f.rowCount ?? 0,
        };
      });

  if (filesToInsert.length === 0) {
    logger.warn('No Parquet files in manifest to insert', {
      manifestId: manifest.manifestId,
    });
    return { filesProcessed: 0, totalRowsInserted: 0, errors: [] };
  }

  logger.info('Inserting Parquet files into ClickHouse', {
    manifestId: manifest.manifestId,
    dataset: manifest.spec.dataset,
    mode,
    fileCount: filesToInsert.length,
    table,
  });

  // Insert each file
  for (const file of filesToInsert) {
    try {
      let result: { rowsInserted: number; errors: string[] };

      switch (mode) {
        case 'client':
          result = await insertParquetClient(file.path, table, skipErrors);
          break;
        case 'local-file':
          result = await insertParquetLocalFile(file.path, table, skipErrors);
          break;
        case 's3':
          result = await insertParquetS3(file.path, table, skipErrors);
          break;
        default:
          throw new Error(`Unsupported insert mode: ${mode}`);
      }

      filesProcessed++;
      totalRowsInserted += result.rowsInserted || file.rowCount || 0;
      errors.push(...result.errors);

      logger.info('Inserted Parquet file', {
        path: file.path,
        rowsInserted: result.rowsInserted || file.rowCount || 0,
        mode,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (skipErrors) {
        errors.push(`Failed to insert ${file.path}: ${errorMessage}`);
        logger.warn('Failed to insert Parquet file (skipped)', {
          path: file.path,
          error: errorMessage,
        });
      } else {
        logger.error('Failed to insert Parquet file', error as Error, {
          path: file.path,
          table,
          mode,
        });
        throw error;
      }
    }
  }

  logger.info('Completed inserting Parquet files', {
    manifestId: manifest.manifestId,
    filesProcessed,
    totalRowsInserted,
    errors: errors.length,
  });

  return { filesProcessed, totalRowsInserted, errors };
}
