/**
 * DuckDB Client
 *
 * Provides a unified interface for DuckDB operations.
 * Wraps PythonEngine calls to maintain separation of concerns.
 */

import { PythonEngine, getPythonEngine } from '@quantbot/utils';
import { logger } from '@quantbot/utils';
import { z } from 'zod';

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
 * DuckDB Client
 * Provides repository-like interface for DuckDB operations
 */
export class DuckDBClient {
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
  ): Promise<T> {
    try {
      const result = await this.pythonEngine.runScript(
        scriptPath,
        {
          operation,
          'db-path': this.dbPath,
          ...params,
        },
        resultSchema
      );
      return result;
    } catch (error) {
      logger.error('DuckDB operation failed', error as Error, { operation, scriptPath });
      throw error;
    }
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
