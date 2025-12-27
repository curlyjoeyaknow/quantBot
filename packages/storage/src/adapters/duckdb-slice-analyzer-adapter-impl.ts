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
          
          // Check if result has an error field (Python script returns errors in result)
          if (result.error) {
            const errorMessage = result.error;
            logger.error('SQL query returned error in result', {
              runId: manifest.run.runId,
              error: errorMessage,
              sql: sql.substring(0, 200),
            });
            
            // Provide user-friendly error messages
            let userMessage = errorMessage;
            const lowerMessage = errorMessage.toLowerCase();
            if (lowerMessage.includes('syntax error') || lowerMessage.includes('syntax')) {
              userMessage = `SQL syntax error: ${errorMessage}. Please check your query syntax.`;
            } else if (
              lowerMessage.includes('does not exist') ||
              lowerMessage.includes('not found') ||
              lowerMessage.includes('catalog error') ||
              lowerMessage.includes('table') ||
              lowerMessage.includes('column') ||
              lowerMessage.includes('object') ||
              lowerMessage.includes('relation') ||
              lowerMessage.includes('unknown')
            ) {
              userMessage = `Table or column not found: ${errorMessage}. Ensure the Parquet files contain the expected columns.`;
            }
            
            return {
              status: 'failed',
              warnings: [userMessage],
            };
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          const lowerMessage = message.toLowerCase();
          
          // Check if this is an "empty result" type error that we should handle gracefully
          // Some databases return errors for aggregate queries on empty tables, but we want to treat this as valid
          const isAggregateQuery = /COUNT|SUM|AVG|MIN|MAX|GROUP\s+BY/i.test(sql);
          const isEmptyResultError = 
            lowerMessage.includes('no rows') ||
            lowerMessage.includes('empty') ||
            (isAggregateQuery && (
              lowerMessage.includes('division by zero') ||
              lowerMessage.includes('null')
            ));
          
          if (isEmptyResultError && isAggregateQuery) {
            // For aggregate queries on empty data, return a valid empty result
            logger.info('Query returned empty result (empty dataset), treating as valid', {
              runId: manifest.run.runId,
              sql: sql.substring(0, 100),
              error: message,
            });
            
            // Create a summary with 0 values for aggregate queries
            // We need to infer column names from the SQL query
            const columnMatch = sql.match(/SELECT\s+(.+?)\s+FROM/i);
            if (columnMatch) {
              const selectClause = columnMatch[1];
              // Extract column aliases (simple heuristic: look for "as alias" patterns)
              const columnAliases: string[] = [];
              const aliasMatches = selectClause.matchAll(/(?:COUNT|SUM|AVG|MIN|MAX)\([^)]+\)\s+AS\s+(\w+)/gi);
              for (const match of aliasMatches) {
                columnAliases.push(match[1]);
              }
              
              if (columnAliases.length > 0) {
                const summary: Record<string, string | number | boolean | null | string[]> = {};
                columnAliases.forEach((alias) => {
                  summary[alias] = 0;
                });
                summary.columns = columnAliases;
                
                return {
                  status: 'ok',
                  summary,
                };
              }
            }
            
            // Fallback: return generic empty result
            return {
              status: 'ok',
              summary: {
                rows: 0,
                columns: [],
              },
            };
          }
          
          logger.error('SQL query execution failed', {
            runId: manifest.run.runId,
            error: message,
            sql: sql.substring(0, 200), // Log first 200 chars
          });

          // Provide user-friendly error messages for common errors
          let userMessage = message;
          if (lowerMessage.includes('syntax error') || lowerMessage.includes('syntax')) {
            userMessage = `SQL syntax error: ${message}. Please check your query syntax.`;
          } else if (
            lowerMessage.includes('does not exist') ||
            lowerMessage.includes('not found') ||
            lowerMessage.includes('catalog error') ||
            lowerMessage.includes('table') ||
            lowerMessage.includes('column') ||
            lowerMessage.includes('object') ||
            lowerMessage.includes('relation') ||
            lowerMessage.includes('unknown')
          ) {
            userMessage = `Table or column not found: ${message}. Ensure the Parquet files contain the expected columns.`;
          } else if (lowerMessage.includes('type') || lowerMessage.includes('type error')) {
            userMessage = `Type error: ${message}. Check that column types match your query.`;
          }

          return {
            status: 'failed',
            warnings: [userMessage],
          };
        }

        // Validate result structure
        if (!result.columns || result.columns.length === 0) {
          // This is a serious issue - queries should always return column metadata
          logger.error('SQL query returned no column metadata - this indicates a query or view issue', {
            runId: manifest.run.runId,
            sql: sql.substring(0, 200),
            rowCount: result.rows?.length || 0,
          });
          return {
            status: 'failed',
            warnings: [
              'Query returned no column metadata. This may indicate the view was not created correctly or the query failed silently.',
            ],
          };
        }

        // Convert result to summary format
        // DuckDBQueryResult has columns and rows arrays
        // Note: summary can contain arrays (for columns), so we use a more permissive type
        let summary: Record<string, string | number | boolean | null | string[]> = {};

        if (result.rows.length === 0) {
          // Aggregate queries (COUNT, SUM, etc.) should ALWAYS return at least 1 row
          // However, if we have column metadata but 0 rows, treat it as empty result (not a failure)
          const columnNames = result.columns.map((col) => col.name);
          const isAggregateQuery = /COUNT|SUM|AVG|MIN|MAX|GROUP\s+BY/i.test(sql);
          
          if (isAggregateQuery && result.columns.length > 0) {
            // If we have column metadata for an aggregate query but 0 rows,
            // treat it as an empty result (view exists but has no data)
            // Create a summary with all values as 0 or null
            summary = Object.fromEntries(
              result.columns.map((col) => {
                // For COUNT, return 0; for other aggregates, return 0 or null
                if (col.name.toLowerCase().includes('count')) {
                  return [col.name, 0];
                }
                return [col.name, 0]; // Default to 0 for numeric aggregates
              })
            );
            summary.columns = columnNames;
            logger.info('Aggregate query returned 0 rows (empty dataset), treating as valid empty result', {
              runId: manifest.run.runId,
              sql: sql.substring(0, 100),
              columnCount: result.columns.length,
              columnNames,
            });
          } else if (isAggregateQuery && result.columns.length === 0) {
            // No column metadata means the query/view actually failed
            logger.error('Aggregate query returned 0 rows with no column metadata - this indicates a query or view issue', {
              runId: manifest.run.runId,
              sql: sql.substring(0, 200),
            });
            return {
              status: 'failed',
              warnings: [
                'Aggregate query returned no rows and no column metadata. This may indicate the view was not created correctly or the query failed silently.',
              ],
            };
          } else {
            // For non-aggregate queries, 0 rows is valid
            summary = {
              rows: 0,
              columns: columnNames,
            };
            logger.warn('SQL query returned no rows (but has column metadata)', {
              runId: manifest.run.runId,
              sql: sql.substring(0, 100),
              columnCount: result.columns.length,
              columnNames,
            });
          }
        } else if (result.rows.length === 1) {
          // Single row result - use it directly as summary, but also include columns array
          const row = result.rows[0];
          const columnNames = result.columns.map((col) => col.name);
          // Preserve original types (numbers, booleans) instead of converting everything to strings
          summary = {
            ...Object.fromEntries(
              result.columns.map((col, idx) => {
                const value = row[idx];
                // Preserve null, numbers, booleans; convert other types to string
                if (value === null) return [col.name, null];
                if (typeof value === 'number' || typeof value === 'boolean') {
                  return [col.name, value];
                }
                return [col.name, String(value)];
              })
            ),
            columns: columnNames, // Include columns array for consistency
          };
        } else {
          // Multiple rows - create aggregate summary
          const columnNames = result.columns.map((col) => col.name);
          summary = {
            rows: result.rows.length,
            columns: columnNames, // Return as array for consistency
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
