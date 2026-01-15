/**
 * Data snapshot hash storage for experiment tracking
 * 
 * Tracks data snapshots used in experiments for reproducibility.
 */

import { z } from 'zod';
import { computeContentHash } from './data-hash.js';

export const DataSnapshotSchema = z.object({
  snapshotId: z.string(),
  snapshotHash: z.string(),
  source: z.string(),
  createdAt: z.number(),
  metadata: z.object({
    rowCount: z.number().optional(),
    startTimestamp: z.number().optional(),
    endTimestamp: z.number().optional(),
    columns: z.array(z.string()).optional(),
    description: z.string().optional(),
  }).optional(),
});

export type DataSnapshot = z.infer<typeof DataSnapshotSchema>;

/**
 * Data snapshot repository interface
 */
export interface DataSnapshotRepository {
  /**
   * Store a data snapshot
   */
  put(snapshot: DataSnapshot): Promise<void>;

  /**
   * Get snapshot by ID
   */
  get(snapshotId: string): Promise<DataSnapshot | null>;

  /**
   * Get snapshot by hash
   */
  getByHash(snapshotHash: string): Promise<DataSnapshot | null>;

  /**
   * List all snapshots for a source
   */
  listBySource(source: string): Promise<DataSnapshot[]>;

  /**
   * Delete a snapshot
   */
  delete(snapshotId: string): Promise<void>;
}

/**
 * In-memory data snapshot repository
 */
export class InMemoryDataSnapshotRepository implements DataSnapshotRepository {
  private snapshots: Map<string, DataSnapshot> = new Map();
  private hashIndex: Map<string, string> = new Map(); // hash -> snapshotId

  async put(snapshot: DataSnapshot): Promise<void> {
    this.snapshots.set(snapshot.snapshotId, snapshot);
    this.hashIndex.set(snapshot.snapshotHash, snapshot.snapshotId);
  }

  async get(snapshotId: string): Promise<DataSnapshot | null> {
    return this.snapshots.get(snapshotId) || null;
  }

  async getByHash(snapshotHash: string): Promise<DataSnapshot | null> {
    const snapshotId = this.hashIndex.get(snapshotHash);
    if (!snapshotId) return null;
    return this.get(snapshotId);
  }

  async listBySource(source: string): Promise<DataSnapshot[]> {
    const result: DataSnapshot[] = [];
    for (const snapshot of this.snapshots.values()) {
      if (snapshot.source === source) {
        result.push(snapshot);
      }
    }
    return result.sort((a, b) => b.createdAt - a.createdAt);
  }

  async delete(snapshotId: string): Promise<void> {
    const snapshot = this.snapshots.get(snapshotId);
    if (snapshot) {
      this.hashIndex.delete(snapshot.snapshotHash);
      this.snapshots.delete(snapshotId);
    }
  }

  /**
   * Clear all snapshots (for testing)
   */
  clear(): void {
    this.snapshots.clear();
    this.hashIndex.clear();
  }

  /**
   * Get statistics
   */
  getStats(): { totalSnapshots: number; sourceCount: number } {
    const sources = new Set<string>();
    for (const snapshot of this.snapshots.values()) {
      sources.add(snapshot.source);
    }

    return {
      totalSnapshots: this.snapshots.size,
      sourceCount: sources.size,
    };
  }
}

/**
 * Create a data snapshot from raw data
 */
export function createDataSnapshot(
  snapshotId: string,
  source: string,
  data: unknown,
  metadata?: DataSnapshot['metadata']
): DataSnapshot {
  const snapshotHash = computeContentHash(data);

  return {
    snapshotId,
    snapshotHash,
    source,
    createdAt: Date.now(),
    metadata,
  };
}

/**
 * Data snapshot service for experiment tracking
 */
export class DataSnapshotService {
  constructor(private readonly repository: DataSnapshotRepository) {}

  /**
   * Create and store a data snapshot
   */
  async snapshot(
    snapshotId: string,
    source: string,
    data: unknown,
    metadata?: DataSnapshot['metadata']
  ): Promise<DataSnapshot> {
    const snapshot = createDataSnapshot(snapshotId, source, data, metadata);

    // Check if snapshot with same hash already exists
    const existing = await this.repository.getByHash(snapshot.snapshotHash);
    if (existing) {
      // Return existing snapshot instead of creating duplicate
      return existing;
    }

    await this.repository.put(snapshot);
    return snapshot;
  }

  /**
   * Get snapshot by ID
   */
  async get(snapshotId: string): Promise<DataSnapshot | null> {
    return this.repository.get(snapshotId);
  }

  /**
   * Check if snapshot exists
   */
  async exists(snapshotId: string): Promise<boolean> {
    const snapshot = await this.repository.get(snapshotId);
    return snapshot !== null;
  }

  /**
   * Find snapshot by content hash
   */
  async findByHash(snapshotHash: string): Promise<DataSnapshot | null> {
    return this.repository.getByHash(snapshotHash);
  }

  /**
   * List all snapshots for a source
   */
  async listBySource(source: string): Promise<DataSnapshot[]> {
    return this.repository.listBySource(source);
  }

  /**
   * Delete a snapshot
   */
  async delete(snapshotId: string): Promise<void> {
    await this.repository.delete(snapshotId);
  }
}

