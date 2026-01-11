/**
 * Snapshot Manager
 *
 * Creates and manages data snapshots with content hashing for reproducibility.
 */

import { createHash } from 'crypto';
import { DateTime } from 'luxon';
import type { SnapshotSpec, DataSnapshotRef, SnapshotQueryOptions } from './types.js';
import type { CanonicalEvent } from '../canonical/schemas.js';
import type { EventCollector } from './event-collector.js';

/**
 * Snapshot storage interface
 */
export interface SnapshotStorage {
  /**
   * Store snapshot reference
   */
  storeSnapshotRef(ref: DataSnapshotRef): Promise<void>;

  /**
   * Retrieve snapshot reference by ID
   */
  getSnapshotRef(snapshotId: string): Promise<DataSnapshotRef | null>;

  /**
   * Store snapshot events
   */
  storeSnapshotEvents(snapshotId: string, events: CanonicalEvent[]): Promise<void>;

  /**
   * Query snapshot events
   */
  querySnapshotEvents(snapshotId: string, options: SnapshotQueryOptions): Promise<CanonicalEvent[]>;
}

/**
 * Snapshot Manager
 */
export class SnapshotManager {
  constructor(
    private readonly storage: SnapshotStorage,
    private readonly eventCollector: EventCollector
  ) {}

  /**
   * Create a data snapshot
   *
   * @param spec - Snapshot specification
   * @returns Snapshot reference with content hash
   */
  async createSnapshot(spec: SnapshotSpec): Promise<DataSnapshotRef> {
    // Generate snapshot ID
    const snapshotId = this.generateSnapshotId(spec);

    // Collect events based on spec
    const events = await this.collectEvents(spec);

    // Generate manifest
    const manifest = this.generateManifest(spec, events);

    // Calculate content hash
    const contentHash = this.calculateContentHash(manifest);

    // Create snapshot reference
    const ref: DataSnapshotRef = {
      snapshotId,
      contentHash,
      createdAt: DateTime.utc().toISO(),
      spec,
      manifest,
    };

    // Store snapshot
    await this.storage.storeSnapshotRef(ref);
    await this.storage.storeSnapshotEvents(snapshotId, events);

    return ref;
  }

  /**
   * Retrieve snapshot by ID
   */
  async getSnapshot(snapshotId: string): Promise<DataSnapshotRef | null> {
    return this.storage.getSnapshotRef(snapshotId);
  }

  /**
   * Query snapshot events
   */
  async querySnapshot(
    snapshotId: string,
    options: SnapshotQueryOptions
  ): Promise<CanonicalEvent[]> {
    return this.storage.querySnapshotEvents(snapshotId, options);
  }

  /**
   * Generate snapshot ID from spec
   */
  private generateSnapshotId(spec: SnapshotSpec): string {
    const specHash = createHash('sha256').update(JSON.stringify(spec)).digest('hex');
    return `snapshot_${specHash.substring(0, 16)}`;
  }

  /**
   * Collect events based on spec
   */
  private async collectEvents(spec: SnapshotSpec): Promise<CanonicalEvent[]> {
    return this.eventCollector.collectEvents(spec);
  }

  /**
   * Generate manifest from events
   */
  private generateManifest(
    spec: SnapshotSpec,
    events: CanonicalEvent[]
  ): DataSnapshotRef['manifest'] {
    const eventCountsByType: Record<string, number> = {};
    const tokenSet = new Set<string>();
    let earliestTimestamp: string | null = null;
    let latestTimestamp: string | null = null;

    for (const event of events) {
      // Count by type
      eventCountsByType[event.eventType] = (eventCountsByType[event.eventType] || 0) + 1;

      // Track tokens
      tokenSet.add(event.asset);

      // Track time range
      if (!earliestTimestamp || event.timestamp < earliestTimestamp) {
        earliestTimestamp = event.timestamp;
      }
      if (!latestTimestamp || event.timestamp > latestTimestamp) {
        latestTimestamp = event.timestamp;
      }
    }

    // Calculate completeness (placeholder - will be enhanced)
    const completeness = events.length > 0 ? 100 : 0;

    return {
      eventCount: events.length,
      eventCountsByType,
      tokenCount: tokenSet.size,
      actualFrom: earliestTimestamp || spec.from,
      actualTo: latestTimestamp || spec.to,
      quality: {
        completeness,
        missingData: [],
        anomalies: [],
      },
    };
  }

  /**
   * Calculate content hash of manifest
   */
  private calculateContentHash(manifest: DataSnapshotRef['manifest']): string {
    return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  }
}
