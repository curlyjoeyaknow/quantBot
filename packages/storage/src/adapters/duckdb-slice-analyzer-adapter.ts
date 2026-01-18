/**
 * DuckDB Slice Analyzer Adapter
 *
 * Implements SliceAnalyzerPort to analyze Parquet slices in DuckDB.
 * Handles all I/O operations: DuckDB connections, Parquet file reading, SQL execution.
 */

import { logger } from '@quantbot/infra/utils';
import type {
  SliceAnalyzerPort,
  SliceManifest,
  AnalysisQueryPlan,
  AnalysisResult,
} from '@quantbot/core';
import { DuckDBClient } from '../duckdb/duckdb-client.js';

/**
 * DuckDB Slice Analyzer Adapter
 *
 * This adapter does the "dirty work":
 * - Creates/opens DuckDB file (or in-memory)
 * - Attaches Parquet as external tables/views
 * - Runs analysis SQL
 * - Emits results (Parquet/JSON/CSV)
 */
export class DuckDbSliceAnalyzerAdapter implements SliceAnalyzerPort {
  /**
   * Analyze a Parquet slice using DuckDB
   *
   * @param manifest - Slice manifest (passed as data, not read from disk)
   * @param queryPlan - Analysis query plan
   */
  async analyze(manifest: SliceManifest, queryPlan: AnalysisQueryPlan): Promise<AnalysisResult> {
    const startTime = Date.now();
    let client: DuckDBClient | null = null;

    try {
      // Create DuckDB client (in-memory for analysis)
      client = new DuckDBClient(':memory:');

      // Attach Parquet files as external tables
      await this.attachParquetFiles(client, manifest);

      // Execute analysis query
      const result = await this.executeQuery(client, queryPlan, manifest);

      const executionTimeMs = Date.now() - startTime;

      logger.info('Slice analysis completed', {
        exportId: manifest.exportId,
        rowCount: result.rowCount,
        executionTimeMs,
      });

      return {
        success: true,
        data: result.data,
        metadata: {
          rowCount: result.rowCount,
          columns: result.columns,
          executionTimeMs,
          outputPath: result.outputPath,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Slice analysis failed', {
        exportId: manifest.exportId,
        error: message,
      });

      return {
        success: false,
        metadata: {
          rowCount: 0,
          columns: [],
          executionTimeMs: Date.now() - startTime,
        },
        error: message,
      };
    } finally {
      // Clean up DuckDB connection
      if (client) {
        await client.close();
      }
    }
  }

  /**
   * Attach Parquet files as external tables in DuckDB
   */
  private async attachParquetFiles(client: DuckDBClient, manifest: SliceManifest): Promise<void> {
    // Install and load Parquet extension
    await client.execute('INSTALL parquet');
    await client.execute('LOAD parquet');

    // Attach each Parquet file as a table
    // Use table name from the original table spec
    for (const file of manifest.parquetFiles) {
      // Extract table name from file path
      // Format: {tableName}_{exportId}.parquet
      const fileName = file.path;
      const tableNameMatch = fileName.match(/^([^_]+)_/);
      const tableName = tableNameMatch ? tableNameMatch[1] : `table_${file.path}`;

      // Use absolute path for Parquet file
      const parquetPath = file.absolutePath;

      // Create view/table from Parquet file
      await client.execute(`
        CREATE OR REPLACE VIEW ${tableName} AS
        SELECT * FROM read_parquet('${parquetPath}')
      `);

      logger.debug('Attached Parquet file as table', {
        tableName,
        file: file.path,
      });
    }
  }

  /**
   * Execute analysis query
   */
  private async executeQuery(
    client: DuckDBClient,
    queryPlan: AnalysisQueryPlan,
    manifest: SliceManifest
  ): Promise<{
    rowCount: number;
    columns: string[];
    data?: unknown[];
    outputPath?: string;
  }> {
    // Replace query parameters if provided
    let sql = queryPlan.sql;
    if (queryPlan.parameters) {
      for (const [key, value] of Object.entries(queryPlan.parameters)) {
        const placeholder = `{${key}}`;
        const replacement =
          typeof value === 'string' ? `'${value.replace(/'/g, "''")}'` : String(value);
        sql = sql.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), replacement);
      }
    }

    logger.info('Executing analysis query', {
      exportId: manifest.exportId,
      queryLength: sql.length,
    });

    // Execute query based on output format
    switch (queryPlan.outputFormat) {
      case 'parquet':
        return await this.executeParquetOutput(client, sql, queryPlan.outputPath || '');

      case 'csv':
        return await this.executeCsvOutput(client, sql, queryPlan.outputPath || '');

      case 'json':
        return await this.executeJsonOutput(client, sql);

      case 'table':
      default:
        return await this.executeTableOutput(client, sql);
    }
  }

  /**
   * Execute query and output to Parquet
   */
  private async executeParquetOutput(
    client: DuckDBClient,
    sql: string,
    outputPath: string
  ): Promise<{
    rowCount: number;
    columns: string[];
    outputPath: string;
  }> {
    // Create output directory if needed
    const { promises: fs } = await import('fs');
    const { dirname } = await import('path');
    await fs.mkdir(dirname(outputPath), { recursive: true });

    // Execute query and write to Parquet
    await client.execute(`COPY (${sql}) TO '${outputPath}' (FORMAT PARQUET)`);

    // Get row count and columns
    const result = await client.query(`SELECT * FROM (${sql}) LIMIT 0`);
    const columns = result.columns.map((col) => col.name);

    // Count rows
    const countResult = await client.query(`SELECT COUNT(*) as cnt FROM (${sql})`);
    const rowCount = countResult.rows[0]?.[0] || 0;

    return {
      rowCount: Number(rowCount),
      columns,
      outputPath,
    };
  }

  /**
   * Execute query and output to CSV
   */
  private async executeCsvOutput(
    client: DuckDBClient,
    sql: string,
    outputPath: string
  ): Promise<{
    rowCount: number;
    columns: string[];
    outputPath: string;
  }> {
    // Create output directory if needed
    const { promises: fs } = await import('fs');
    const { dirname } = await import('path');
    await fs.mkdir(dirname(outputPath), { recursive: true });

    // Execute query and write to CSV
    await client.execute(`COPY (${sql}) TO '${outputPath}' (FORMAT CSV, HEADER, DELIMITER ',')`);

    // Get row count and columns
    const result = await client.query(`SELECT * FROM (${sql}) LIMIT 0`);
    const columns = result.columns.map((col) => col.name);

    // Count rows
    const countResult = await client.query(`SELECT COUNT(*) as cnt FROM (${sql})`);
    const rowCount = countResult.rows[0]?.[0] || 0;

    return {
      rowCount: Number(rowCount),
      columns,
      outputPath,
    };
  }

  /**
   * Execute query and return JSON
   */
  private async executeJsonOutput(
    client: DuckDBClient,
    sql: string
  ): Promise<{
    rowCount: number;
    columns: string[];
    data: unknown[];
  }> {
    const result = await client.query(sql);
    const columns = result.columns.map((col) => col.name);
    const rows = result.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < columns.length; i++) {
        obj[columns[i]] = row[i];
      }
      return obj;
    });

    return {
      rowCount: rows.length,
      columns,
      data: rows,
    };
  }

  /**
   * Execute query and return table data
   */
  private async executeTableOutput(
    client: DuckDBClient,
    sql: string
  ): Promise<{
    rowCount: number;
    columns: string[];
    data: unknown[];
  }> {
    return await this.executeJsonOutput(client, sql);
  }
}

/**
 * Create DuckDB slice analyzer adapter
 */
export function createDuckDbSliceAnalyzerAdapter(): SliceAnalyzerPort {
  return new DuckDbSliceAnalyzerAdapter();
}
