/**
 * Raw Data Hash Repository
 *
 * Provides hash lookup service for idempotency checks.
 * Tracks raw data hashes to prevent duplicate ingestion.
 */

import { openDuckDb, type DuckDbConnection } from '../adapters/duckdb/duckdbClient.js';
import { existsSync } from 'fs';

export interface RawDataHashRecord {
  hash: string;
  sourceType: string;
  sourcePath?: string;
  ingestedAt: Date;
  runId?: string;
  metadata?: Record<string, unknown>;
}

export interface HashLookupResult {
  exists: boolean;
  record?: RawDataHashRecord;
}

/**
 * Raw Data Hash Repository
 *
 * Provides methods to check and store raw data hashes for idempotency.
 */
export class RawDataHashRepository {
  constructor(private readonly db: DuckDbConnection) {}

  /**
   * Check if a hash exists
   */
  async checkHash(hash: string): Promise<HashLookupResult> {
    try {
      const rows = await this.db.all<any>(
        `SELECT hash, source_type, source_path, ingested_at, run_id, metadata_json
         FROM raw_data_hashes
         WHERE hash = ?
         LIMIT 1`,
        [hash]
      );

      if (rows.length === 0) {
        return { exists: false };
      }

      const row = rows[0];
      return {
        exists: true,
        record: {
          hash: row.hash,
          sourceType: row.source_type,
          sourcePath: row.source_path || undefined,
          ingestedAt: new Date(row.ingested_at),
          runId: row.run_id || undefined,
          metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
        },
      };
    } catch (error) {
      // If table doesn't exist, hash doesn't exist
      if (error instanceof Error && error.message.includes('does not exist')) {
        return { exists: false };
      }
      throw error;
    }
  }

  /**
   * Store a hash
   */
  async storeHash(
    hash: string,
    sourceType: string,
    options?: {
      sourcePath?: string;
      runId?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    const metadataJson = options?.metadata ? JSON.stringify(options.metadata) : null;

    await this.db.run(
      `INSERT OR IGNORE INTO raw_data_hashes
       (hash, source_type, source_path, run_id, metadata_json)
       VALUES (?, ?, ?, ?, ?)`,
      [hash, sourceType, options?.sourcePath || null, options?.runId || null, metadataJson]
    );
  }

  /**
   * Create repository from DuckDB path
   */
  static async fromPath(dbPath: string, readOnly: boolean = true): Promise<RawDataHashRepository> {
    if (!existsSync(dbPath)) {
      throw new Error(`DuckDB file not found: ${dbPath}`);
    }

    const db = await openDuckDb(dbPath, { readOnly });
    return new RawDataHashRepository(db);
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    await this.db.close();
  }
}
