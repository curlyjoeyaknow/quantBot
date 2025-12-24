/**
 * DuckDB Client
 *
 * Provides a unified interface for DuckDB operations.
 * Wraps PythonEngine calls to maintain separation of concerns.
 */

import { PythonEngine, getPythonEngine } from '@quantbot/utils';
import { logger } from '@quantbot/utils';
import { z } from 'zod';
import { join } from 'path';

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
});

/**
 * DuckDB query result type
 */
export interface DuckDBQueryResult {
  columns: Array<{ name: string; type: string }>;
  rows: unknown[][];
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
        await this.pythonEngine.runScript(
          this.getDirectSqlScriptPath(),
          {
            operation: 'execute_sql',
            'db-path': this.dbPath,
            sql,
          },
          DuckDBResultSchema
        );
        return;
      } catch (error) {
        logger.error('DuckDB SQL execution failed', error as Error, { sql });
        throw error;
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
      logger.error('DuckDB operation failed', error as Error, {
        operation,
        scriptPath: scriptPathOrSql,
      });
      throw error;
    }
  }

  /**
   * Execute SQL query and return results
   */
  async query(sql: string): Promise<DuckDBQueryResult> {
    try {
      const result = await this.pythonEngine.runScript(
        this.getDirectSqlScriptPath(),
        {
          operation: 'query_sql',
          'db-path': this.dbPath,
          sql,
        },
        DuckDBQueryResultSchema
      );
      return result;
    } catch (error) {
      logger.error('DuckDB query failed', error as Error, { sql });
      throw error;
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
      logger.error('Failed to close DuckDB connection', error as Error);
      throw error;
    }
  }

  /**
   * Get path to direct SQL execution script
   */
  private getDirectSqlScriptPath(): string {
    return join(process.cwd(), 'tools/storage/duckdb_direct_sql.py');
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
