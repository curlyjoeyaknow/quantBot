/**
 * Universal Bus Integration for Backtest Results
 *
 * Writes Parquet files directly and submits to artifact bus with metadata.json.
 * No intermediate DuckDB step - cleaner and more efficient.
 *
 * Usage:
 *   await writeBacktestResults({
 *     runId: 'run-123',
 *     artifactsDir: 'artifacts/backtest/run-123',
 *     backtestType: 'path-only',
 *     tableName: 'backtest_call_path_metrics',
 *     data: pathMetricsRows,
 *     metadata: { interval: '1m', callsProcessed: 100 }
 *   });
 */

import { join } from 'path';
import { promises as fs } from 'fs';
import { logger } from '@quantbot/utils';
import { submitArtifact } from '@quantbot/infra/utils';
import { DuckDBClient } from '@quantbot/storage';

export interface WriteBacktestResultsOptions {
  /**
   * Unique run identifier
   */
  runId: string;
  /**
   * Directory where artifacts will be written
   */
  artifactsDir: string;
  /**
   * Type of backtest (path-only, policy, full)
   */
  backtestType: 'path-only' | 'policy' | 'full';
  /**
   * Table/artifact name (e.g., 'backtest_call_path_metrics', 'backtest_call_results')
   */
  tableName: string;
  /**
   * Data rows to write (array of objects)
   */
  data: Array<Record<string, unknown>>;
  /**
   * Metadata to include in metadata.json and bus submission
   */
  metadata: {
    interval: string;
    callsProcessed: number;
    rowsWritten: number;
    [key: string]: unknown;
  };
}

/**
 * Universal helper: Write backtest results directly to Parquet + metadata.json and submit to bus
 *
 * This function:
 * 1. Writes data directly to Parquet (no DuckDB intermediate)
 * 2. Creates metadata.json with run info
 * 3. Submits Parquet to bus
 * 4. Submits metadata.json to bus (daemon will write it to catalog)
 *
 * All backtest commands should use this instead of creating DuckDB files.
 */
export async function writeBacktestResults(
  options: WriteBacktestResultsOptions
): Promise<{ parquetPath: string; metadataPath: string }> {
  const { runId, artifactsDir, backtestType, data, tableName, metadata } = options;

  await fs.mkdir(artifactsDir, { recursive: true });

  const parquetPath = join(artifactsDir, `${tableName}.parquet`);
  const metadataPath = join(artifactsDir, 'metadata.json');

  if (data.length === 0) {
    logger.debug('No data to write for backtest result', { runId, tableName });
    // Still create empty metadata.json
    const metadataContent = {
      run_id: runId,
      backtest_type: backtestType,
      table_name: tableName,
      rows: 0,
      created_at_utc: new Date().toISOString(),
      ...metadata,
    };
    await fs.writeFile(metadataPath, JSON.stringify(metadataContent, null, 2), 'utf-8');
    return { parquetPath, metadataPath };
  }

  try {
    // Write Parquet directly (no DuckDB intermediate)
    const db = new DuckDBClient(':memory:');
    try {
      await db.execute('INSTALL parquet;');
      await db.execute('LOAD parquet;');

      // Infer schema from first row and create table
      const firstRow = data[0];
      const columns = Object.keys(firstRow);
      const columnDefs = columns
        .map((col) => {
          const value = firstRow[col];
          if (value === null || value === undefined) {
            // Can't infer from null, use TEXT as safe default
            return `${col} TEXT`;
          } else if (typeof value === 'number') {
            return Number.isInteger(value) ? `${col} BIGINT` : `${col} DOUBLE`;
          } else if (typeof value === 'boolean') {
            return `${col} BOOLEAN`;
          } else {
            return `${col} TEXT`;
          }
        })
        .join(', ');

      await db.execute(`CREATE TABLE temp_data (${columnDefs})`);

      // Insert data (DuckDBClient.execute doesn't support parameters, so we build SQL safely)
      // Insert rows in batches for better performance
      const batchSize = 1000;
      for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize);
        for (const row of batch) {
          const values = columns.map((col) => {
            const val = row[col];
            if (val === null || val === undefined) {
              return 'NULL';
            } else if (typeof val === 'string') {
              return `'${String(val).replace(/'/g, "''")}'`;
            } else if (typeof val === 'boolean') {
              return val ? 'TRUE' : 'FALSE';
            } else {
              return String(val);
            }
          });
          await db.execute(
            `INSERT INTO temp_data (${columns.join(', ')}) VALUES (${values.join(', ')})`
          );
        }
      }

      // Export to Parquet
      await db.execute(`COPY temp_data TO '${parquetPath.replace(/'/g, "''")}' (FORMAT PARQUET)`);
    } finally {
      await db.close();
    }

    // Write metadata.json (daemon will read this and write to catalog)
    const metadataContent = {
      run_id: runId,
      backtest_type: backtestType,
      table_name: tableName,
      rows: data.length,
      created_at_utc: new Date().toISOString(),
      parquet_file: `${tableName}.parquet`,
      parquet_path: parquetPath,
      ...metadata,
    };
    await fs.writeFile(metadataPath, JSON.stringify(metadataContent, null, 2), 'utf-8');

    // Submit Parquet to bus
    const busResult = await submitArtifact({
      runId,
      producer: 'backtest',
      kind: `${backtestType}_${tableName}`,
      artifactId: tableName,
      parquetPath,
      schemaHint: `backtest.${tableName}`,
      rows: data.length,
      meta: {
        backtestType,
        tableName,
        metadataFile: 'metadata.json',
        ...metadata,
      },
    });

    if (busResult.success) {
      logger.info('Backtest results written and submitted to bus', {
        runId,
        tableName,
        rows: data.length,
        parquetPath,
        metadataPath,
      });
    } else {
      logger.warn('Failed to submit backtest results to bus', {
        runId,
        tableName,
        error: busResult.error,
      });
    }

    return { parquetPath, metadataPath };
  } catch (error) {
    // Don't fail the backtest if bus submission fails
    logger.warn('Failed to write backtest results to bus (results still written locally)', {
      runId,
      tableName,
      error: error instanceof Error ? error.message : String(error),
    });
    return { parquetPath, metadataPath };
  }
}
