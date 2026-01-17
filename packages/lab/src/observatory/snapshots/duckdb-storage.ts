/**
 * DuckDB Snapshot Storage
 *
 * Stores snapshot references and events in DuckDB for fast querying.
 */

import { join } from 'path';
import { tmpdir } from 'os';
import { writeFileSync, unlinkSync } from 'fs';
import { DuckDBClient } from '@quantbot/infra/storage';
import { logger, DatabaseError, findWorkspaceRoot } from '@quantbot/infra/utils';
import { z } from 'zod';
import type { DataSnapshotRef, SnapshotQueryOptions } from './types.js';
import { DataSnapshotRefSchema } from './types.js';
import type { CanonicalEvent } from '../canonical/schemas.js';
import type { SnapshotStorage } from './snapshot-manager.js';

/**
 * Result schema for snapshot ref operations
 */
const SnapshotRefResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});

/**
 * Snapshot ref response schema
 */
const SnapshotRefResponseSchema = DataSnapshotRefSchema.nullable();

/**
 * Events array schema
 */
const EventsArraySchema = z.array(z.unknown());

/**
 * DuckDB-based snapshot storage
 */
export class DuckDBSnapshotStorage implements SnapshotStorage {
  private client: DuckDBClient;
  private scriptPath: string;

  private initPromise: Promise<void>;

  constructor(dbPath: string, client?: DuckDBClient) {
    this.client = client || new DuckDBClient(dbPath);
    const workspaceRoot = findWorkspaceRoot();
    this.scriptPath = join(workspaceRoot, 'tools', 'data-observatory', 'snapshot_storage.py');
    this.initPromise = this.initializeDatabase();
  }

  /**
   * Wait for database initialization to complete
   */
  async waitForInit(): Promise<void> {
    await this.initPromise;
  }

  /**
   * Initialize database schema
   */
  private async initializeDatabase(): Promise<void> {
    try {
      await this.client.initSchema(this.scriptPath);
      logger.info('DuckDBSnapshotStorage database initialized', {
        dbPath: this.client.getDbPath(),
      });
    } catch (error) {
      logger.error('Failed to initialize DuckDBSnapshotStorage database', error as Error, {
        dbPath: this.client.getDbPath(),
      });
      // Don't throw - allow service to continue with degraded functionality
    }
  }

  /**
   * Store snapshot reference
   */
  async storeSnapshotRef(ref: DataSnapshotRef): Promise<void> {
    // Ensure database is initialized before storing
    await this.waitForInit();

    try {
      const result: { success: boolean; error?: string } = await this.client.execute(
        this.scriptPath,
        'store_ref',
        {
          data: JSON.stringify(ref),
        },
        SnapshotRefResultSchema
      );

      if (!result.success) {
        throw new DatabaseError(
          result.error || 'Failed to store snapshot ref',
          'storeSnapshotRef',
          { result, ref }
        );
      }

      logger.debug('Stored snapshot ref', { snapshotId: ref.snapshotId });
    } catch (error) {
      logger.error('Failed to store snapshot ref', error as Error, {
        snapshotId: ref.snapshotId,
      });
      throw error;
    }
  }

  /**
   * Retrieve snapshot reference by ID
   */
  async getSnapshotRef(snapshotId: string): Promise<DataSnapshotRef | null> {
    // Ensure database is initialized before querying
    await this.waitForInit();

    try {
      const result: DataSnapshotRef | null = await this.client.execute(
        this.scriptPath,
        'get_ref',
        {
          'snapshot-id': snapshotId,
        },
        SnapshotRefResponseSchema
      );

      return result;
    } catch (error) {
      logger.error('Failed to get snapshot ref', error as Error, { snapshotId });
      throw error;
    }
  }

  /**
   * Store snapshot events
   */
  async storeSnapshotEvents(snapshotId: string, events: CanonicalEvent[]): Promise<void> {
    // Ensure database is initialized before storing
    await this.waitForInit();

    // Use temporary file for large data to avoid E2BIG error (command line argument size limit)
    // Threshold: 100KB (conservative limit, system limit is typically 128KB-2MB)
    const dataString = JSON.stringify(events);
    const dataSizeBytes = Buffer.byteLength(dataString, 'utf8');
    const useTempFile = dataSizeBytes > 100 * 1024; // 100KB threshold

    let tempFilePath: string | undefined;

    try {
      const params: Record<string, unknown> = {
        'snapshot-id': snapshotId,
      };

      if (useTempFile) {
        // Write data to temporary file
        tempFilePath = join(
          tmpdir(),
          `snapshot-events-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
        );
        writeFileSync(tempFilePath, dataString, 'utf8');
        params['data-file'] = tempFilePath;

        logger.debug('Using temporary file for large event data', {
          snapshotId,
          eventCount: events.length,
          dataSizeBytes,
          tempFilePath,
        });
      } else {
        // Use command line argument for small data
        params.data = dataString;
      }

      const result: { success: boolean; error?: string } = await this.client.execute(
        this.scriptPath,
        'store_events',
        params,
        SnapshotRefResultSchema
      );

      if (!result.success) {
        throw new DatabaseError(
          result.error || 'Failed to store snapshot events',
          'storeSnapshotEvents',
          {
            result,
            snapshotId,
            eventsCount: events.length,
          }
        );
      }

      logger.debug('Stored snapshot events', {
        snapshotId,
        count: events.length,
      });
    } catch (error) {
      logger.error('Failed to store snapshot events', error as Error, {
        snapshotId,
        eventCount: events.length,
      });
      throw error;
    } finally {
      // Clean up temporary file if used
      if (tempFilePath) {
        try {
          unlinkSync(tempFilePath);
        } catch (cleanupError) {
          logger.warn('Failed to clean up temporary file', {
            tempFilePath,
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          });
        }
      }
    }
  }

  /**
   * Query snapshot events with filters
   */
  async querySnapshotEvents(
    snapshotId: string,
    options: SnapshotQueryOptions
  ): Promise<CanonicalEvent[]> {
    // Ensure database is initialized before querying
    await this.waitForInit();

    try {
      const result: unknown[] = await this.client.execute(
        this.scriptPath,
        'query_events',
        {
          'snapshot-id': snapshotId,
          options: JSON.stringify(options),
        },
        EventsArraySchema
      );

      // Validate events against CanonicalEvent schema
      // Note: We accept z.unknown() in the schema above for flexibility,
      // but should validate here if needed
      return result as CanonicalEvent[];
    } catch (error) {
      logger.error('Failed to query snapshot events', error as Error, {
        snapshotId,
        options,
      });
      throw error;
    }
  }
}
