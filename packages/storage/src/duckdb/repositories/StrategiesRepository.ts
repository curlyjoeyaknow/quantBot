/**
 * StrategiesRepository - DuckDB repository for strategies
 *
 * Handles all database operations for strategies table.
 */

import { DateTime } from 'luxon';
import { logger, DatabaseError, findWorkspaceRoot } from '@quantbot/utils';
import { join } from 'path';
import { z } from 'zod';
import type { StrategyConfig } from '@quantbot/core';
import { DuckDBClient } from '../duckdb-client.js';

export interface StrategyInsertData {
  name: string;
  version?: string;
  category?: string;
  description?: string;
  config: Record<string, unknown>;
  isActive?: boolean;
}

/**
 * DuckDB StrategiesRepository
 */
export class StrategiesRepository {
  private client: DuckDBClient;
  private scriptPath: string;

  constructor(dbPath: string, client?: DuckDBClient) {
    this.client = client || new DuckDBClient(dbPath);
    // Resolve script path relative to workspace root (find root by looking for tools/ directory)
    const workspaceRoot = findWorkspaceRoot();
    this.scriptPath = join(workspaceRoot, 'tools/storage/duckdb_strategies.py');
    // NOTE: Do NOT call initializeDatabase() here - it holds a database lock
    // The Python script uses CREATE TABLE IF NOT EXISTS, so initialization happens on first use
  }

  /**
   * Initialize DuckDB database and schema
   *
   * NOTE: This is intentionally NOT called in constructor to avoid holding database locks.
   * The database schema is created lazily on first use or can be initialized explicitly.
   */
  private async initializeDatabase(): Promise<void> {
    try {
      await this.client.initSchema(this.scriptPath);
      logger.info('StrategiesRepository database initialized', { dbPath: this.client.getDbPath() });
    } catch (error) {
      logger.error('Failed to initialize StrategiesRepository database', error as Error, {
        dbPath: this.client.getDbPath(),
      });
      // CRITICAL: Always throw - silent failures give false confidence in results
      // If database initialization fails, subsequent operations will also fail.
      // Better to fail fast and surface the error than silently continue with broken state.
      throw new DatabaseError(
        'StrategiesRepository database initialization failed',
        'initializeDatabase',
        {
          dbPath: this.client.getDbPath(),
          originalError: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
        }
      );
    }
  }

  /**
   * Find all active strategies
   */
  async findAllActive(): Promise<StrategyConfig[]> {
    try {
      const resultSchema = z.array(
        z.object({
          id: z.number(),
          name: z.string(),
          version: z.string(),
          category: z.string().nullable(),
          description: z.string().nullable(),
          config_json: z.record(z.string(), z.unknown()),
          is_active: z.boolean(),
          created_at: z.string(),
          updated_at: z.string(),
        })
      );

      const result = await this.client.execute(
        this.scriptPath,
        'find_all_active',
        {},
        resultSchema
      );

      // Ensure we always return an array, even if result is null/undefined
      if (!result || !Array.isArray(result)) {
        return [];
      }

      return result.map((row) => ({
        name: row.name,
        version: row.version,
        category: row.category || undefined,
        description: row.description || undefined,
        config: row.config_json,
        isActive: row.is_active,
        createdAt: DateTime.fromISO(row.created_at),
        updatedAt: DateTime.fromISO(row.updated_at),
      }));
    } catch (error) {
      logger.error('Failed to find all active strategies', error as Error);
      throw error;
    }
  }

  /**
   * Find strategy by name (and optionally version)
   */
  async findByName(name: string, version?: string): Promise<StrategyConfig | null> {
    try {
      const _scriptPath = join(process.cwd(), 'tools/storage/duckdb_strategies.py');
      const resultSchema = z
        .object({
          id: z.number(),
          name: z.string(),
          version: z.string(),
          category: z.string().nullable(),
          description: z.string().nullable(),
          config_json: z.record(z.string(), z.unknown()),
          is_active: z.boolean(),
          created_at: z.string(),
          updated_at: z.string(),
        })
        .nullable();

      const versionToUse = version || '1';

      const result = await this.client.execute(
        this.scriptPath,
        'find_by_name',
        { name, version: versionToUse },
        resultSchema
      );

      if (!result) {
        return null;
      }

      return {
        name: result.name,
        version: result.version,
        category: result.category || undefined,
        description: result.description || undefined,
        config: result.config_json,
        isActive: result.is_active,
        createdAt: DateTime.fromISO(result.created_at),
        updatedAt: DateTime.fromISO(result.updated_at),
      };
    } catch (error) {
      logger.error('Failed to find strategy by name', error as Error, { name, version });
      throw error;
    }
  }

  /**
   * Create a new strategy
   */
  async create(data: StrategyInsertData): Promise<number> {
    try {
      const resultSchema = z.object({
        id: z.number(),
      });

      const versionToUse = data.version || '1';

      const result = await this.client.execute(
        this.scriptPath,
        'create',
        {
          data: JSON.stringify({
            name: data.name,
            version: versionToUse,
            category: data.category,
            description: data.description,
            config_json: data.config,
            is_active: data.isActive !== false,
          }),
        },
        resultSchema
      );

      logger.info('Created strategy', {
        id: result.id,
        name: data.name,
        version: versionToUse,
      });
      return result.id;
    } catch (error) {
      logger.error('Failed to create strategy', error as Error, { name: data.name });
      throw error;
    }
  }

  /**
   * List all strategies
   */
  async list(): Promise<StrategyConfig[]> {
    try {
      // Use a more flexible schema that can handle both arrays and error objects
      const flexibleSchema = z.union([
        z.array(
          z.object({
            id: z.number(),
            name: z.string(),
            version: z.string(),
            category: z.string().nullable(),
            description: z.string().nullable(),
            config_json: z.record(z.string(), z.unknown()),
            is_active: z.boolean(),
            created_at: z.string(),
            updated_at: z.string(),
          })
        ),
        z.object({
          error: z.string(),
        }),
      ]);

      const rawResult = await this.client.execute(this.scriptPath, 'list', {}, flexibleSchema);

      // Handle error object from Python script
      if (rawResult && typeof rawResult === 'object' && 'error' in rawResult) {
        logger.warn('Python script returned error', {
          error: (rawResult as { error: string }).error,
        });
        return [];
      }

      // Ensure we have an array
      const result = Array.isArray(rawResult) ? rawResult : [];

      return result.map((row) => ({
        name: row.name,
        version: row.version,
        category: row.category || undefined,
        description: row.description || undefined,
        config: row.config_json,
        isActive: row.is_active,
        createdAt: DateTime.fromISO(row.created_at),
        updatedAt: DateTime.fromISO(row.updated_at),
      }));
    } catch (error) {
      // If validation fails (e.g., Python returned unexpected format), log and return empty array
      if (error instanceof z.ZodError) {
        logger.warn('Strategy list validation failed, returning empty array', {
          error: error.message,
          issues: error.issues,
        });
        return [];
      }
      logger.error('Failed to list strategies', error as Error);
      // Return empty array instead of throwing to allow graceful degradation
      return [];
    }
  }
}
