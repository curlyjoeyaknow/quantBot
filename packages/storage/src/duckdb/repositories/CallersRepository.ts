/**
 * CallersRepository - DuckDB repository for callers (signal sources)
 *
 * Extracts and manages caller information from calls data in DuckDB.
 * Callers are derived from user_calls_d and caller_links_d tables.
 */

import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import { join } from 'path';
import { z } from 'zod';
import type { Caller } from '@quantbot/core';
import { DuckDBClient } from '../duckdb-client.js';

export interface CallerInsertData {
  source: string;
  handle: string;
  displayName?: string;
  attributes?: Record<string, unknown>;
}

/**
 * DuckDB CallersRepository
 */
export class CallersRepository {
  private client: DuckDBClient;
  private scriptPath: string;

  constructor(dbPath: string, client?: DuckDBClient) {
    this.client = client || new DuckDBClient(dbPath);
    this.scriptPath = join(process.cwd(), 'tools/storage/duckdb_callers.py');
    this.initializeDatabase();
  }

  /**
   * Initialize DuckDB database and schema
   */
  private async initializeDatabase(): Promise<void> {
    try {
      await this.client.initSchema(this.scriptPath);
      logger.info('CallersRepository database initialized', { dbPath: this.client.getDbPath() });
    } catch (error) {
      logger.error('Failed to initialize CallersRepository database', error as Error, {
        dbPath: this.client.getDbPath(),
      });
      // Don't throw - allow service to continue with degraded functionality
    }
  }

  /**
   * Get or create a caller by source and handle
   * If caller doesn't exist, extracts from calls data
   */
  async getOrCreateCaller(
    source: string,
    handle: string,
    displayName?: string,
    attributes?: Record<string, unknown>
  ): Promise<Caller> {
    try {
      const resultSchema = z.object({
        id: z.number(),
        source: z.string(),
        handle: z.string(),
        display_name: z.string().nullable(),
        attributes_json: z.record(z.string(), z.unknown()).nullable(),
        created_at: z.string(),
        updated_at: z.string(),
      });

      const result = await this.client.execute(
        this.scriptPath,
        'get_or_create',
        {
          source,
          handle,
          display_name: displayName,
          attributes: attributes ? JSON.stringify(attributes) : null,
        },
        resultSchema
      );

      return {
        id: result.id,
        source: result.source,
        handle: result.handle,
        displayName: result.display_name || undefined,
        attributes: result.attributes_json || undefined,
        createdAt: DateTime.fromISO(result.created_at),
        updatedAt: DateTime.fromISO(result.updated_at),
      };
    } catch (error) {
      logger.error('Failed to get or create caller', error as Error, { source, handle });
      throw error;
    }
  }

  /**
   * Find caller by name (source + handle combination)
   */
  async findByName(source: string, handle: string): Promise<Caller | null> {
    try {
      const resultSchema = z
        .object({
          id: z.number(),
          source: z.string(),
          handle: z.string(),
          display_name: z.string().nullable(),
          attributes_json: z.record(z.string(), z.unknown()).nullable(),
          created_at: z.string(),
          updated_at: z.string(),
        })
        .nullable();

      const result = await this.client.execute(
        this.scriptPath,
        'find_by_name',
        { source, handle },
        resultSchema
      );

      if (!result) {
        return null;
      }

      return {
        id: result.id,
        source: result.source,
        handle: result.handle,
        displayName: result.display_name || undefined,
        attributes: result.attributes_json || undefined,
        createdAt: DateTime.fromISO(result.created_at),
        updatedAt: DateTime.fromISO(result.updated_at),
      };
    } catch (error) {
      logger.error('Failed to find caller by name', error as Error, { source, handle });
      throw error;
    }
  }

  /**
   * Find caller by ID
   */
  async findById(id: number): Promise<Caller | null> {
    try {
      const resultSchema = z
        .object({
          id: z.number(),
          source: z.string(),
          handle: z.string(),
          display_name: z.string().nullable(),
          attributes_json: z.record(z.string(), z.unknown()).nullable(),
          created_at: z.string(),
          updated_at: z.string(),
        })
        .nullable();

      const result = await this.client.execute(this.scriptPath, 'find_by_id', { id }, resultSchema);

      if (!result) {
        return null;
      }

      return {
        id: result.id,
        source: result.source,
        handle: result.handle,
        displayName: result.display_name || undefined,
        attributes: result.attributes_json || undefined,
        createdAt: DateTime.fromISO(result.created_at),
        updatedAt: DateTime.fromISO(result.updated_at),
      };
    } catch (error) {
      logger.error('Failed to find caller by ID', error as Error, { id });
      throw error;
    }
  }

  /**
   * List all callers
   */
  async list(): Promise<Caller[]> {
    try {
      const scriptPath = join(process.cwd(), 'tools/storage/duckdb_callers.py');
      const resultSchema = z.array(
        z.object({
          id: z.number(),
          source: z.string(),
          handle: z.string(),
          display_name: z.string().nullable(),
          attributes_json: z.record(z.string(), z.unknown()).nullable(),
          created_at: z.string(),
          updated_at: z.string(),
        })
      );

      const result = await this.client.execute(this.scriptPath, 'list', {}, resultSchema);

      return result.map((row) => ({
        id: row.id,
        source: row.source,
        handle: row.handle,
        displayName: row.display_name || undefined,
        attributes: row.attributes_json || undefined,
        createdAt: DateTime.fromISO(row.created_at),
        updatedAt: DateTime.fromISO(row.updated_at),
      }));
    } catch (error) {
      logger.error('Failed to list callers', error as Error);
      throw error;
    }
  }

  /**
   * Sync callers from calls data
   * Extracts unique callers from user_calls_d and caller_links_d tables
   */
  async syncFromCalls(): Promise<number> {
    try {
      const resultSchema = z.object({
        synced_count: z.number(),
      });

      const result = await this.client.execute(
        this.scriptPath,
        'sync_from_calls',
        {},
        resultSchema
      );

      logger.info('Synced callers from calls data', { count: result.synced_count });
      return result.synced_count;
    } catch (error) {
      logger.error('Failed to sync callers from calls', error as Error);
      throw error;
    }
  }
}
