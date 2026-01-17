/**
 * Raw data hash tracking for idempotency
 *
 * Ensures data ingestion is idempotent by tracking content hashes.
 */

import { createHash } from 'crypto';
import { z } from 'zod';

export const DataHashSchema = z.object({
  dataId: z.string(),
  contentHash: z.string(),
  source: z.string(),
  ingestedAt: z.number(),
  metadata: z.record(z.unknown()).optional(),
});

export type DataHash = z.infer<typeof DataHashSchema>;

/**
 * Compute content hash for raw data
 */
export function computeContentHash(data: unknown): string {
  const normalized = JSON.stringify(data, Object.keys(data as object).sort());
  return createHash('sha256').update(normalized).digest('hex');
}

/**
 * Data hash repository interface
 */
export interface DataHashRepository {
  /**
   * Store a data hash
   */
  put(dataHash: DataHash): Promise<void>;

  /**
   * Check if data with this hash already exists
   */
  exists(contentHash: string): Promise<boolean>;

  /**
   * Get data hash by content hash
   */
  get(contentHash: string): Promise<DataHash | null>;

  /**
   * Get all hashes for a source
   */
  getBySource(source: string): Promise<DataHash[]>;

  /**
   * Delete a data hash
   */
  delete(contentHash: string): Promise<void>;
}

/**
 * In-memory data hash repository
 */
export class InMemoryDataHashRepository implements DataHashRepository {
  private hashes: Map<string, DataHash> = new Map();

  async put(dataHash: DataHash): Promise<void> {
    this.hashes.set(dataHash.contentHash, dataHash);
  }

  async exists(contentHash: string): Promise<boolean> {
    return this.hashes.has(contentHash);
  }

  async get(contentHash: string): Promise<DataHash | null> {
    return this.hashes.get(contentHash) || null;
  }

  async getBySource(source: string): Promise<DataHash[]> {
    const result: DataHash[] = [];
    for (const hash of this.hashes.values()) {
      if (hash.source === source) {
        result.push(hash);
      }
    }
    return result;
  }

  async delete(contentHash: string): Promise<void> {
    this.hashes.delete(contentHash);
  }

  /**
   * Clear all hashes (for testing)
   */
  clear(): void {
    this.hashes.clear();
  }

  /**
   * Get statistics
   */
  getStats(): { totalHashes: number; sourceCount: number } {
    const sources = new Set<string>();
    for (const hash of this.hashes.values()) {
      sources.add(hash.source);
    }

    return {
      totalHashes: this.hashes.size,
      sourceCount: sources.size,
    };
  }
}

/**
 * Idempotent data ingestion wrapper
 */
export class IdempotentIngestion<T> {
  constructor(
    private readonly hashRepo: DataHashRepository,
    private readonly source: string
  ) {}

  /**
   * Ingest data idempotently
   * Returns true if data was ingested, false if it was a duplicate
   */
  async ingest(
    dataId: string,
    data: T,
    ingestFn: (data: T) => Promise<void>,
    metadata?: Record<string, unknown>
  ): Promise<{ ingested: boolean; contentHash: string }> {
    const contentHash = computeContentHash(data);

    // Check if already ingested
    const exists = await this.hashRepo.exists(contentHash);
    if (exists) {
      return { ingested: false, contentHash };
    }

    // Ingest data
    await ingestFn(data);

    // Store hash
    await this.hashRepo.put({
      dataId,
      contentHash,
      source: this.source,
      ingestedAt: Date.now(),
      metadata,
    });

    return { ingested: true, contentHash };
  }

  /**
   * Check if data would be a duplicate without ingesting
   */
  async isDuplicate(data: T): Promise<boolean> {
    const contentHash = computeContentHash(data);
    return await this.hashRepo.exists(contentHash);
  }

  /**
   * Get ingestion statistics for this source
   */
  async getStats(): Promise<{
    totalIngested: number;
    oldestIngestedAt: number | null;
    newestIngestedAt: number | null;
  }> {
    const hashes = await this.hashRepo.getBySource(this.source);

    if (hashes.length === 0) {
      return {
        totalIngested: 0,
        oldestIngestedAt: null,
        newestIngestedAt: null,
      };
    }

    const timestamps = hashes.map((h) => h.ingestedAt);

    return {
      totalIngested: hashes.length,
      oldestIngestedAt: Math.min(...timestamps),
      newestIngestedAt: Math.max(...timestamps),
    };
  }
}
