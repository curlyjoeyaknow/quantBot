/**
 * DuckDB Slice Analyzer Adapter - Working Implementation
 *
 * Simple implementation that:
 * - Opens DuckDB (in-memory)
 * - Attaches Parquet files from manifest
 * - Executes SQL queries
 * - Returns summary results
 */

import { DuckDBClient } from '../duckdb/duckdb-client.js';
import { logger } from '@quantbot/utils';
import type {
  SliceAnalyzer,
  SliceAnalysisResult,
  SliceAnalysisSpec,
  RunContext,
  SliceManifestV1,
} from '@quantbot/core';

/**
 * DuckDB Slice Analyzer Adapter - Implementation
 */
export class DuckDbSliceAnalyzerAdapterImpl implements SliceAnalyzer {
  async analyze(args: {
    run: RunContext;
    manifest: SliceManifestV1;
    analysis: SliceAnalysisSpec;
  }): Promise<SliceAnalysisResult> {
    const { manifest, analysis } = args;

    // Manifest version gate: fail loud on unknown versions
    if (manifest.version !== 1) {
      throw new Error(
        `Unsupported manifest version: ${manifest.version}. Analyzer only supports version 1.`
      );
    }

    let db: DuckDBClient | null = null;

    try {
      // Open DuckDB (in-memory for analysis)
      db = new DuckDBClient(':memory:');

      // Install and load Parquet extension
      await db.execute('INSTALL parquet;');
      await db.execute('LOAD parquet;');

      // Attach Parquet files as a view
      // DuckDB can read multiple Parquet files directly
      const parquetPaths = manifest.parquetFiles.map((f) => {
        // Handle file:// prefix
        const path = f.path.replace(/^file:\/\//, '');
        return `'${path}'`;
      });

      if (parquetPaths.length === 0) {
        return {
          status: 'failed',
          warnings: ['No Parquet files in manifest'],
        };
      }

      // Create view from Parquet files
      // DuckDB can read multiple files: read_parquet(['file1.parquet', 'file2.parquet'])
      const createViewSql = `
        CREATE OR REPLACE VIEW slice AS 
        SELECT * FROM read_parquet([${parquetPaths.join(', ')}])
      `;

      await db.execute(createViewSql);

      logger.info('Attached Parquet files to DuckDB', {
        exportId: manifest.run.runId,
        fileCount: parquetPaths.length,
      });

      // Execute analysis
      if (analysis.kind === 'sql') {
        // Execute SQL query
        const result = await db.query(analysis.sql);

        // Convert result to summary format
        // DuckDBQueryResult has columns and rows arrays
        let summary: Record<string, string | number | boolean | null> = {};

        if (result.rows.length === 0) {
          summary = { rows: 0 };
        } else if (result.rows.length === 1) {
          // Single row result - use it directly as summary
          const row = result.rows[0];
          summary = Object.fromEntries(
            result.columns.map((col, idx) => [
              col.name,
              row[idx] === null ? null : String(row[idx]),
            ])
          );
        } else {
          // Multiple rows - create aggregate summary
          const columnNames = result.columns.map((col) => col.name);
          summary = {
            rows: result.rows.length,
            columns: columnNames.join(', '), // Convert array to string for summary
          };
        }

        logger.info('Analysis completed', {
          exportId: manifest.run.runId,
          resultRows: result.rows.length,
        });

        return {
          status: 'ok',
          summary,
        };
      }

      // Named plan support (not implemented yet)
      return {
        status: 'skipped',
        warnings: [`Named plan '${analysis.planId}' not implemented yet`],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Analysis failed', {
        exportId: manifest.run.runId,
        error: message,
      });

      return {
        status: 'failed',
        warnings: [message],
      };
    } finally {
      // Clean up DuckDB connection
      if (db) {
        await db.close();
      }
    }
  }
}

/**
 * Create DuckDB slice analyzer adapter
 */
export function createDuckDbSliceAnalyzerAdapterImpl(): SliceAnalyzer {
  return new DuckDbSliceAnalyzerAdapterImpl();
}
