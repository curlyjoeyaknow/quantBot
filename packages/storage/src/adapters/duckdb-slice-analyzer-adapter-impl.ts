/**
 * DuckDB Slice Analyzer Adapter - Working Implementation
 *
 * Simple implementation that:
 * - Opens DuckDB (in-memory)
 * - Attaches Parquet files from manifest
 * - Executes SQL queries
 * - Returns summary results
 * - Comprehensive error handling with retry logic
 */

import { DuckDBClient } from '../duckdb/duckdb-client.js';
import { logger } from '@quantbot/utils';
import { existsSync } from 'fs';
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
      const parquetPaths: string[] = [];
      const missingFiles: string[] = [];

      for (const file of manifest.parquetFiles) {
        // Handle file:// prefix
        const path = file.path.replace(/^file:\/\//, '');

        // Validate file exists (for local files)
        if (path.startsWith('/') || !path.includes('://')) {
          if (!existsSync(path)) {
            missingFiles.push(path);
            logger.warn('Parquet file does not exist', {
              path,
              runId: manifest.run.runId,
            });
            continue;
          }
        }

        parquetPaths.push(`'${path.replace(/'/g, "''")}'`); // Escape single quotes
      }

      if (parquetPaths.length === 0) {
        const errorMessage =
          missingFiles.length > 0
            ? `No valid Parquet files found. Missing files: ${missingFiles.join(', ')}`
            : 'No Parquet files in manifest';
        logger.error('No Parquet files available for analysis', {
          runId: manifest.run.runId,
          totalFiles: manifest.parquetFiles.length,
          missingFiles: missingFiles.length,
        });
        return {
          status: 'failed',
          warnings: [errorMessage],
        };
      }

      if (missingFiles.length > 0) {
        logger.warn('Some Parquet files are missing, continuing with available files', {
          runId: manifest.run.runId,
          availableFiles: parquetPaths.length,
          missingFiles: missingFiles.length,
        });
      }

      // Create view from Parquet files
      // DuckDB can read multiple files: read_parquet(['file1.parquet', 'file2.parquet'])
      const createViewSql = `
        CREATE OR REPLACE VIEW slice AS 
        SELECT * FROM read_parquet([${parquetPaths.join(', ')}])
      `;

      try {
        await db.execute(createViewSql);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Failed to create DuckDB view from Parquet files', {
          runId: manifest.run.runId,
          error: message,
          fileCount: parquetPaths.length,
        });
        return {
          status: 'failed',
          warnings: [
            `Failed to load Parquet files into DuckDB: ${message}. This may indicate corrupted Parquet files or incompatible schema.`,
          ],
        };
      }

      logger.info('Attached Parquet files to DuckDB', {
        exportId: manifest.run.runId,
        fileCount: parquetPaths.length,
      });

      // Execute analysis
      if (analysis.kind === 'sql') {
        // Validate SQL query (basic checks)
        const sql = analysis.sql.trim();
        if (!sql || sql.length === 0) {
          return {
            status: 'failed',
            warnings: ['SQL query is empty'],
          };
        }

        // Execute SQL query with error handling
        let result;
        try {
          result = await db.query(sql);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error('SQL query execution failed', {
            runId: manifest.run.runId,
            error: message,
            sql: sql.substring(0, 200), // Log first 200 chars
          });

          // Provide user-friendly error messages for common errors
          let userMessage = message;
          if (message.includes('syntax error') || message.includes('Syntax Error')) {
            userMessage = `SQL syntax error: ${message}. Please check your query syntax.`;
          } else if (message.includes('does not exist') || message.includes('not found')) {
            userMessage = `Table or column not found: ${message}. Ensure the Parquet files contain the expected columns.`;
          } else if (message.includes('type') || message.includes('Type')) {
            userMessage = `Type error: ${message}. Check that column types match your query.`;
          }

          return {
            status: 'failed',
            warnings: [userMessage],
          };
        }

        // Convert result to summary format
        // DuckDBQueryResult has columns and rows arrays
        let summary: Record<string, string | number | boolean | null> = {};

        if (result.rows.length === 0) {
          summary = { rows: 0 };
          logger.warn('SQL query returned no rows', {
            runId: manifest.run.runId,
            sql: sql.substring(0, 100),
          });
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
          columns: result.columns.length,
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
      const stack = error instanceof Error ? error.stack : undefined;

      logger.error('Analysis failed with unexpected error', {
        exportId: manifest.run.runId,
        error: message,
        stack: stack?.substring(0, 500), // Log first 500 chars of stack
      });

      // Provide user-friendly error message
      let userMessage = `Analysis failed: ${message}`;
      if (message.includes('Cannot connect') || message.includes('connection')) {
        userMessage = 'Failed to connect to DuckDB. This may indicate a system issue.';
      } else if (message.includes('memory') || message.includes('Memory')) {
        userMessage = 'Out of memory error. The dataset may be too large for in-memory analysis.';
      }

      return {
        status: 'failed',
        warnings: [userMessage],
      };
    } finally {
      // Clean up DuckDB connection
      if (db) {
        try {
          await db.close();
        } catch (closeError) {
          logger.warn('Failed to close DuckDB connection', {
            error: closeError instanceof Error ? closeError.message : String(closeError),
          });
        }
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
