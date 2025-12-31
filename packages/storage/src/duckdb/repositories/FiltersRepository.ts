/**
 * FiltersRepository - DuckDB repository for filters
 *
 * Handles all database operations for filters table (FilterV1 presets).
 */

import { logger, DatabaseError, findWorkspaceRoot } from '@quantbot/utils';
import { join } from 'path';
import { z } from 'zod';
import { DuckDBClient } from '../duckdb-client.js';

export interface FilterV1 {
  schema_version: number;
  id: string;
  name: string;
  chains: string[];
  age_minutes?: {
    min?: number;
    max?: number;
  };
  mcap_usd?: {
    min?: number;
    max?: number;
  };
}

/**
 * Zod schema for FilterV1 validation
 */
export const FilterV1Schema = z.object({
  schema_version: z.number(),
  id: z.string(),
  name: z.string(),
  chains: z.array(z.string()),
  age_minutes: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
  mcap_usd: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
});

export interface FilterInsertData {
  id: string;
  name: string;
  json: FilterV1;
}

/**
 * DuckDB FiltersRepository
 */
export class FiltersRepository {
  private client: DuckDBClient;
  private scriptPath: string;

  constructor(dbPath: string, client?: DuckDBClient) {
    this.client = client || new DuckDBClient(dbPath);
    const workspaceRoot = findWorkspaceRoot();
    this.scriptPath = join(workspaceRoot, 'tools/storage/duckdb_filters.py');
  }

  /**
   * Initialize DuckDB database and schema
   */
  private async initializeDatabase(): Promise<void> {
    try {
      await this.client.initSchema(this.scriptPath);
      logger.info('FiltersRepository database initialized', { dbPath: this.client.getDbPath() });
    } catch (error) {
      logger.error('Failed to initialize FiltersRepository database', error as Error, {
        dbPath: this.client.getDbPath(),
      });
      throw new DatabaseError(
        'FiltersRepository database initialization failed',
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
   * Find filter by ID
   */
  async findById(filterId: string): Promise<FilterV1 | null> {
    try {
      const resultSchema = z
        .object({
          id: z.string(),
          name: z.string(),
          json: z.record(z.string(), z.unknown()),
          updated_at: z.string().nullable(),
        })
        .nullable();

      const result = await this.client.execute(
        this.scriptPath,
        'find_by_id',
        { filter_id: filterId },
        resultSchema
      );

      if (!result) {
        return null;
      }

      // Validate and parse the JSON to ensure type safety
      const parsed = FilterV1Schema.parse(result.json);
      return parsed;
    } catch (error) {
      logger.error('Failed to find filter by ID', error as Error, { filterId });
      throw error;
    }
  }

  /**
   * List all filters
   */
  async list(): Promise<FilterV1[]> {
    try {
      const resultSchema = z.object({
        filters: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            json: z.record(z.string(), z.unknown()),
            updated_at: z.string().nullable(),
          })
        ),
      });

      const result = await this.client.execute(this.scriptPath, 'list', {}, resultSchema);

      if (!result || !result.filters) {
        return [];
      }

      // Validate and parse each filter JSON to ensure type safety
      return result.filters.map((row) => FilterV1Schema.parse(row.json));
    } catch (error) {
      logger.error('Failed to list filters', error as Error);
      throw error;
    }
  }

  /**
   * Create a new filter
   */
  async create(data: FilterInsertData): Promise<void> {
    try {
      const resultSchema = z.object({
        success: z.boolean(),
        error: z.string().optional(),
        id: z.string().optional(),
      });

      const result = await this.client.execute(
        this.scriptPath,
        'create',
        {
          data: JSON.stringify({
            id: data.id,
            name: data.name,
            json: data.json,
          }),
        },
        resultSchema
      );

      if (!result.success) {
        throw new DatabaseError(
          `Failed to create filter: ${result.error || 'Unknown error'}`,
          'create',
          { filterId: data.id }
        );
      }
    } catch (error) {
      logger.error('Failed to create filter', error as Error, { filterId: data.id });
      throw error;
    }
  }

  /**
   * Delete a filter
   */
  async delete(filterId: string): Promise<void> {
    try {
      const resultSchema = z.object({
        success: z.boolean(),
        error: z.string().optional(),
      });

      const result = await this.client.execute(
        this.scriptPath,
        'delete',
        { filter_id: filterId },
        resultSchema
      );

      if (!result.success) {
        throw new DatabaseError(
          `Failed to delete filter: ${result.error || 'Unknown error'}`,
          'delete',
          { filterId }
        );
      }
    } catch (error) {
      logger.error('Failed to delete filter', error as Error, { filterId });
      throw error;
    }
  }
}
