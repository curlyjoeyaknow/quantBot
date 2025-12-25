/**
 * DuckDB Snapshot Storage
 *
 * Stores snapshot references and events in DuckDB for fast querying.
 */

import { join, dirname } from 'path';
import { existsSync, readFileSync } from 'fs';
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
    const workspaceRoot = this.findWorkspaceRoot();
    this.scriptPath = join(workspaceRoot, 'tools', 'data-observatory', 'snapshot_storage.py');
    this.initPromise = this.initializeDatabase();
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
    
    try {
      const result: { success: boolean; error?: string } = await this.client.execute(
        this.scriptPath,
        'store_events',
        {
          'snapshot-id': snapshotId,
          data: JSON.stringify(events),
        },
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
