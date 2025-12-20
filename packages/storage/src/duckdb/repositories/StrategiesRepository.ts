/**
 * StrategiesRepository - DuckDB repository for strategies
 *
 * Handles all database operations for strategies table.
 */

import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
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
    this.scriptPath = join(process.cwd(), 'tools/storage/duckdb_strategies.py');
    this.initializeDatabase();
  }

  /**
   * Initialize DuckDB database and schema
   */
  private async initializeDatabase(): Promise<void> {
    try {
      await this.client.initSchema(this.scriptPath);
      logger.info('StrategiesRepository database initialized', { dbPath: this.client.getDbPath() });
    } catch (error) {
      logger.error('Failed to initialize StrategiesRepository database', error as Error, {
        dbPath: this.client.getDbPath(),
      });
      // Don't throw - allow service to continue with degraded functionality
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

      const result = await this.client.execute(this.scriptPath, 'list', {}, resultSchema);

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
      logger.error('Failed to list strategies', error as Error);
      throw error;
    }
  }
}
