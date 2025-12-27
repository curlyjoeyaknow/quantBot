/**
 * DuckDB Client
 *
 * Provides a unified interface for DuckDB operations.
 * Wraps PythonEngine calls to maintain separation of concerns.
 */

import { PythonEngine, getPythonEngine } from '@quantbot/utils';
import { logger } from '@quantbot/utils';
import { z } from 'zod';
import { join, dirname } from 'path';
import { existsSync, readFileSync } from 'fs';

/**
 * DuckDB operation result schema
 */
const DuckDBResultSchema = z
  .object({
    success: z.boolean(),
    error: z.string().optional(),
  })
  .passthrough();

/**
 * DuckDB query result schema
 */
const DuckDBQueryResultSchema = z.object({
  columns: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
    })
  ),
  rows: z.array(z.array(z.unknown())),
  error: z.string().optional(), // Python script may return errors in result
});

/**
 * DuckDB query result type
 */
export interface DuckDBQueryResult {
  columns: Array<{ name: string; type: string }>;
  rows: unknown[][];
  error?: string; // Python script may return errors in result
}

/**
 * DuckDB Client
 * Provides repository-like interface for DuckDB operations
 */
export class DuckDBClient {
  [x: string]: unknown;
  private pythonEngine: PythonEngine;
  private dbPath: string;

  constructor(dbPath: string, pythonEngine?: PythonEngine) {
    this.dbPath = dbPath;
    this.pythonEngine = pythonEngine || getPythonEngine();
  }

  /**
   * Initialize database schema
   */
  async initSchema(scriptPath: string): Promise<void> {
    try {
      await this.pythonEngine.runScript(
        scriptPath,
        {
          operation: 'init',
          'db-path': this.dbPath,
        },
        DuckDBResultSchema
      );
    } catch (error) {
      logger.error('Failed to initialize DuckDB schema', error as Error, { scriptPath });
      throw error;
    }
  }

  /**
   * Execute a DuckDB operation via Python script
   */
  async execute<T>(
    scriptPath: string,
    operation: string,
    params: Record<string, unknown>,
    resultSchema: z.ZodSchema<T>
  ): Promise<T>;
  /**
   * Execute SQL directly (for in-memory or simple operations)
   */
  async execute(sql: string): Promise<void>;
  async execute<T>(
    scriptPathOrSql: string,
    operation?: string,
    params?: Record<string, unknown>,
    resultSchema?: z.ZodSchema<T>
  ): Promise<T | void> {
    // Overload: Direct SQL execution
    if (operation === undefined) {
      const sql = scriptPathOrSql;
      try {
        // Basic SQL validation
        const trimmedSql = sql.trim();
        if (!trimmedSql || trimmedSql.length === 0) {
          throw new Error('SQL query is empty');
        }

        await this.pythonEngine.runScript(
          this.getDirectSqlScriptPath(),
          {
            operation: 'execute_sql',
            'db-path': this.dbPath,
            sql: trimmedSql,
          },
          DuckDBResultSchema
        );
        return;
      } catch (error) {
        const errorInfo = this.classifyError(error);
        logger.error('DuckDB SQL execution failed', error as Error, {
          category: errorInfo.category,
          sql: sql.substring(0, 200),
          dbPath: this.dbPath,
        });

        // Enhance error with user-friendly message
        const enhancedError = new Error(errorInfo.userMessage);
        enhancedError.cause = error;
        throw enhancedError;
      }
    }

    // Original method: Execute via Python script
    try {
      const result = await this.pythonEngine.runScript(
        scriptPathOrSql,
        {
          operation: operation!,
          'db-path': this.dbPath,
          ...params!,
        },
        resultSchema!
      );
      return result;
    } catch (error) {
      const errorInfo = this.classifyError(error);
      logger.error('DuckDB operation failed', error as Error, {
        category: errorInfo.category,
        operation,
        scriptPath: scriptPathOrSql,
        dbPath: this.dbPath,
      });

      // Enhance error with user-friendly message
      const enhancedError = new Error(errorInfo.userMessage);
      enhancedError.cause = error;
      throw enhancedError;
    }
  }

  /**
   * Classify DuckDB error for better error handling
   */
  private classifyError(error: unknown): {
    category: 'syntax' | 'type' | 'missing' | 'connection' | 'unknown';
    userMessage: string;
  } {
    if (!(error instanceof Error)) {
      return {
        category: 'unknown',
        userMessage: 'Unknown error occurred',
      };
    }

    const message = error.message.toLowerCase();
    let category: 'syntax' | 'type' | 'missing' | 'connection' | 'unknown';
    let userMessage: string;

    if (message.includes('syntax error') || message.includes('syntax')) {
      category = 'syntax';
      userMessage = `SQL syntax error: ${error.message}. Please check your query syntax.`;
    } else if (message.includes('type') || message.includes('cannot convert')) {
      category = 'type';
      userMessage = `Type error: ${error.message}. Check that column types match your query.`;
    } else if (
      message.includes('does not exist') ||
      message.includes('not found') ||
      message.includes('no such table') ||
      message.includes('no such column')
    ) {
      category = 'missing';
      userMessage = `Table or column not found: ${error.message}. Ensure the database schema matches your query.`;
    } else if (
      message.includes('cannot connect') ||
      message.includes('connection') ||
      message.includes('database')
    ) {
      category = 'connection';
      userMessage = `Database connection error: ${error.message}. Check that the database file exists and is accessible.`;
    } else {
      category = 'unknown';
      userMessage = `DuckDB error: ${error.message}`;
    }

    return { category, userMessage };
  }

  /**
   * Execute SQL query and return results
   */
  async query(sql: string): Promise<DuckDBQueryResult> {
    try {
      // Basic SQL validation
      const trimmedSql = sql.trim();
      if (!trimmedSql || trimmedSql.length === 0) {
        throw new Error('SQL query is empty');
      }

      const result = await this.pythonEngine.runScript(
        this.getDirectSqlScriptPath(),
        {
          operation: 'query_sql',
          'db-path': this.dbPath,
          sql: trimmedSql,
        },
        DuckDBQueryResultSchema
      );
      return result;
    } catch (error) {
      const errorInfo = this.classifyError(error);
      logger.error('DuckDB query failed', error as Error, {
        category: errorInfo.category,
        sql: sql.substring(0, 200), // Log first 200 chars
        dbPath: this.dbPath,
      });

      // Enhance error with user-friendly message
      const enhancedError = new Error(errorInfo.userMessage);
      enhancedError.cause = error;
      throw enhancedError;
    }
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    try {
      await this.pythonEngine.runScript(
        this.getDirectSqlScriptPath(),
        {
          operation: 'close',
          'db-path': this.dbPath,
        },
        DuckDBResultSchema
      );
    } catch (error) {
      // Log warning instead of error for close failures (connection may already be closed)
      logger.warn('Failed to close DuckDB connection', {
        error: error instanceof Error ? error.message : String(error),
        dbPath: this.dbPath,
      });
      // Don't throw - connection cleanup failures are usually non-critical
    }
  }

  /**
   * Find workspace root by looking for pnpm-workspace.yaml or package.json with workspace config
   */
  private findWorkspaceRoot(): string {
    let current = process.cwd();

    while (current !== '/' && current !== '') {
      const workspaceFile = join(current, 'pnpm-workspace.yaml');
      const packageFile = join(current, 'package.json');

      if (existsSync(workspaceFile)) {
        return current;
      }

      if (existsSync(packageFile)) {
        try {
          const pkg = JSON.parse(readFileSync(packageFile, 'utf8'));
          if (pkg.workspaces || pkg.pnpm?.workspace) {
            return current;
          }
        } catch {
          // Continue searching
        }
      }

      const parent = dirname(current);
      if (parent === current) {
        // Reached filesystem root
        break;
      }
      current = parent;
    }

    // Fallback to process.cwd() if workspace root not found
    return process.cwd();
  }

  /**
   * Get path to direct SQL execution script
   */
  private getDirectSqlScriptPath(): string {
    const workspaceRoot = this.findWorkspaceRoot();
    return join(workspaceRoot, 'tools/storage/duckdb_direct_sql.py');
  }

  /**
   * Get database path
   */
  getDbPath(): string {
    return this.dbPath;
  }
}

/**
 * Get or create DuckDB client
 */
const duckdbClients: Map<string, DuckDBClient> = new Map();

export function getDuckDBClient(dbPath: string): DuckDBClient {
  if (!duckdbClients.has(dbPath)) {
    duckdbClients.set(dbPath, new DuckDBClient(dbPath));
  }
  return duckdbClients.get(dbPath)!;
}
