/**
 * DuckDB Canonical Events Adapter
 *
 * Implements CanonicalRepository port using DuckDB for storage.
 */

import { join } from 'path';
import { z } from 'zod';
import type {
  CanonicalRepository,
  CanonicalEventQueryFilter,
  CanonicalEventQueryResult,
  CanonicalEvent,
} from '@quantbot/core';
import { CanonicalEventSchema } from '@quantbot/core';
import { DuckDBClient } from '../duckdb/duckdb-client.js';
import { logger, findWorkspaceRoot } from '@quantbot/infra/utils';

const CanonicalEventResponseSchema = CanonicalEventSchema;

const CanonicalEventQueryResultSchema = z.object({
  events: z.array(CanonicalEventSchema),
  total: z.number().int(),
});

const CanonicalEventListSchema = z.array(CanonicalEventSchema);

/**
 * DuckDB Canonical Events Adapter
 */
export class CanonicalDuckDBAdapter implements CanonicalRepository {
  private client: DuckDBClient;
  private scriptPath: string;

  constructor(dbPath: string, client?: DuckDBClient) {
    this.client = client || new DuckDBClient(dbPath);
    const workspaceRoot = findWorkspaceRoot();
    this.scriptPath = join(workspaceRoot, 'tools/storage/duckdb_canonical.py');
  }

  async store(event: CanonicalEvent): Promise<void> {
    try {
      await this.client.execute(
        this.scriptPath,
        'store',
        { data: JSON.stringify(event) },
        z.object({ success: z.boolean() })
      );
    } catch (error) {
      logger.error('Failed to store canonical event', error as Error, {
        eventId: event.id,
      });
      throw error;
    }
  }

  async storeBatch(events: CanonicalEvent[]): Promise<void> {
    try {
      await this.client.execute(
        this.scriptPath,
        'store_batch',
        { data: JSON.stringify(events) },
        z.object({ success: z.boolean(), count: z.number().int() })
      );
    } catch (error) {
      logger.error('Failed to store canonical events batch', error as Error, {
        count: events.length,
      });
      throw error;
    }
  }

  async get(id: string): Promise<CanonicalEvent | null> {
    try {
      const result = await this.client.execute(
        this.scriptPath,
        'get',
        { data: JSON.stringify({ id }) },
        z.union([CanonicalEventResponseSchema, z.object({ error: z.string() })])
      );

      if ('error' in result) {
        return null;
      }

      return result as CanonicalEvent;
    } catch (error) {
      logger.error('Failed to get canonical event', error as Error, { id });
      return null;
    }
  }

  async query(filter: CanonicalEventQueryFilter): Promise<CanonicalEventQueryResult> {
    try {
      const result = await this.client.execute(
        this.scriptPath,
        'query',
        { data: JSON.stringify(filter) },
        CanonicalEventQueryResultSchema
      );

      return result as CanonicalEventQueryResult;
    } catch (error) {
      logger.error('Failed to query canonical events', error as Error, { filter });
      return {
        events: [],
        total: 0,
      };
    }
  }

  async getByAsset(
    assetAddress: string,
    timeRange?: { from: string; to: string },
    eventTypes?: CanonicalEvent['eventType'][]
  ): Promise<CanonicalEvent[]> {
    try {
      const result = await this.client.execute(
        this.scriptPath,
        'get_by_asset',
        {
          data: JSON.stringify({
            assetAddress,
            timeRange,
            eventTypes,
          }),
        },
        CanonicalEventListSchema
      );

      return result as CanonicalEvent[];
    } catch (error) {
      logger.error('Failed to get canonical events by asset', error as Error, {
        assetAddress,
      });
      return [];
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Try to initialize schema to check availability
      await this.client.execute(this.scriptPath, 'init', {}, z.object({ success: z.boolean() }));
      return true;
    } catch (error) {
      logger.warn('CanonicalDuckDBAdapter is not available', { error: error as Error });
      return false;
    }
  }
}
