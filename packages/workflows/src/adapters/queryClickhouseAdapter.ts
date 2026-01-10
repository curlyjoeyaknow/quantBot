/**
 * QueryPort ClickHouse Adapter
 *
 * Implements QueryPort for analytical queries against ClickHouse.
 * This adapter is specifically for analytical queries (SELECT, COUNT, GROUP BY, etc.).
 */

import type { QueryPort, QueryRequest, QueryResult } from '@quantbot/core';
import { getClickHouseClient } from '@quantbot/storage';

/**
 * Creates a ClickHouse-backed QueryPort adapter for analytical queries
 */
export function createQueryClickhouseAdapter(): QueryPort {
  const client = getClickHouseClient();

  return {
    async query(request: QueryRequest): Promise<QueryResult> {
      try {
        // Execute ClickHouse query
        const result = await client.query({
          query: request.query,
          format: request.format ?? 'JSONEachRow',
          query_params: request.params
            ? (request.params as unknown as Record<string, unknown>)
            : undefined,
        });

        const rows = (await result.json()) as Array<Record<string, unknown>>;

        return {
          rows,
          rowCount: rows.length,
        };
      } catch (error) {
        return {
          rows: [],
          rowCount: 0,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async isAvailable(): Promise<boolean> {
      try {
        // Simple health check query
        await client.query({ query: 'SELECT 1', format: 'JSONEachRow' });
        return true;
      } catch {
        return false;
      }
    },
  };
}
