/**
 * DuckDB Raw Data Adapter
 *
 * Implements RawDataRepository port using DuckDB for storage.
 * Raw data is append-only and never modified or deleted.
 */

import { join } from 'path';
import { z } from 'zod';
import type { RawDataRepository, RawDataQueryFilter, RawDataSourceType } from '@quantbot/core';
import type { RawDataRecord } from '@quantbot/core';
import { DuckDBClient } from '../duckdb/duckdb-client.js';
import { logger, findWorkspaceRoot } from '@quantbot/infra/utils';

const RawDataRecordSchema = z.object({
  id: z.string(),
  sourceType: z.string(),
  sourceId: z.string(),
  hash: z.string(),
  content: z.string(),
  runId: z.string(),
  ingestedAt: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const RawDataListSchema = z.array(RawDataRecordSchema);

const SourceListSchema = z.array(
  z.object({
    sourceType: z.string(),
    sourceId: z.string(),
    recordCount: z.number(),
  })
);

/**
 * DuckDB Raw Data Adapter
 */
export class RawDataDuckDBAdapter implements RawDataRepository {
  private client: DuckDBClient;
  private scriptPath: string;

  constructor(dbPath: string, client?: DuckDBClient) {
    this.client = client || new DuckDBClient(dbPath);
    const workspaceRoot = findWorkspaceRoot();
    this.scriptPath = join(workspaceRoot, 'tools/storage/duckdb_raw_data.py');
  }

  async query(filter: RawDataQueryFilter): Promise<RawDataRecord[]> {
    try {
      const results = await this.client.execute(
        this.scriptPath,
        'query',
        { data: JSON.stringify(filter) },
        RawDataListSchema
      );

      return results as RawDataRecord[];
    } catch (error) {
      logger.error('Failed to query raw data', error as Error, { filter });
      return [];
    }
  }

  async getByHash(hash: string): Promise<RawDataRecord | null> {
    try {
      const result = await this.client.execute(
        this.scriptPath,
        'get_by_hash',
        { data: JSON.stringify({ hash }) },
        z.union([RawDataRecordSchema, z.object({ error: z.string() })])
      );

      if ('error' in result) {
        return null;
      }

      return result as RawDataRecord;
    } catch (error) {
      logger.error('Failed to get raw data by hash', error as Error, { hash });
      return null;
    }
  }

  async listSources(): Promise<
    Array<{ sourceType: RawDataSourceType; sourceId: string; recordCount: number }>
  > {
    try {
      const results = await this.client.execute(
        this.scriptPath,
        'list_sources',
        {},
        SourceListSchema
      );

      return results.map((r) => ({
        sourceType: r.sourceType as RawDataSourceType,
        sourceId: r.sourceId,
        recordCount: r.recordCount,
      }));
    } catch (error) {
      logger.error('Failed to list raw data sources', error as Error);
      return [];
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Try to execute a simple query to check availability
      await this.client.execute(
        this.scriptPath,
        'list_sources',
        {},
        SourceListSchema
      );
      return true;
    } catch {
      return false;
    }
  }
}

