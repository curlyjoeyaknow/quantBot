/**
 * DuckDB Snapshot Storage
 *
 * Stores snapshot references and events in DuckDB for fast querying.
 */

import { join } from 'path';
import { DuckDBClient } from '@quantbot/storage';
import { logger, DatabaseError } from '@quantbot/utils';
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
    this.scriptPath = join(process.cwd(), 'tools/data-observatory/snapshot_storage.py');
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
    try {
      const result: { success: boolean; error?: string } = await this.client.execute(
        this.scriptPath,
        'store_ref',
        {
          // Fix parameter keys to use kebab-case as expected by the script
          'snapshot-id': ref.snapshotId,
          'source': ref.spec.sources.join(','),
          'from': ref.spec.from,
          'to': ref.spec.to,
          'filters': JSON.stringify(ref.spec.filters ?? {}),
          'manifest': JSON.stringify(ref.manifest ?? {}),
          'description': ref.spec.description ?? '',
          'created-at': ref.createdAt,
          'content-hash': ref.contentHash,
        },
        SnapshotRefResultSchema as any
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
    try {
      const result: DataSnapshotRef | null = await this.client.execute(
        this.scriptPath,
        'get_ref',
        {
          'snapshot-id': snapshotId,
        },
        SnapshotRefResponseSchema as any
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
    try {
      const result: { success: boolean; error?: string } = await this.client.execute(
        this.scriptPath,
        'store_events',
        {
          'snapshot-id': snapshotId,
          data: JSON.stringify(events),
        },
        SnapshotRefResultSchema as any
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
    }
  }

  /**
   * Query snapshot events with filters
   */
  async querySnapshotEvents(
    snapshotId: string,
    options: SnapshotQueryOptions
  ): Promise<CanonicalEvent[]> {
    try {
      const result: unknown[] = await this.client.execute(
        this.scriptPath,
        'query_events',
        {
          'snapshot-id': snapshotId,
          options: JSON.stringify(options),
        },
        EventsArraySchema as any
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
