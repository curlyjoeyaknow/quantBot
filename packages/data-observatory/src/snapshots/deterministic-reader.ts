/**
 * Deterministic Data Reader
 *
 * Provides deterministic, snapshot-based data reads for reproducible workflows.
 * All reads go through snapshots, ensuring consistent results.
 */

import { DateTime } from 'luxon';
import type { DataSnapshotRef, SnapshotQueryOptions } from './types.js';
import type { CanonicalEvent } from '../canonical/schemas.js';
import type { SnapshotStorage } from './snapshot-manager.js';

/**
 * Deterministic reader options
 */
export interface DeterministicReadOptions {
  /**
   * Snapshot reference to read from
   * If provided, all reads will use this snapshot
   */
  snapshotRef?: DataSnapshotRef;

  /**
   * Snapshot ID (alternative to snapshotRef)
   * If provided, will fetch the snapshot reference
   */
  snapshotId?: string;

  /**
   * Query options to filter events
   */
  queryOptions?: SnapshotQueryOptions;
}

/**
 * Deterministic Data Reader
 *
 * Provides deterministic reads through snapshots.
 * All data access goes through snapshot references,
 * ensuring reproducible results.
 */
export class DeterministicDataReader {
  constructor(
    private readonly storage: SnapshotStorage,
    private readonly defaultSnapshotId?: string
  ) {}

  /**
   * Read events deterministically from a snapshot
   *
   * @param options - Read options specifying snapshot and filters
   * @returns Array of canonical events from the snapshot
   */
  async readEvents(options: DeterministicReadOptions = {}): Promise<CanonicalEvent[]> {
    // Determine snapshot ID
    let snapshotId: string | undefined;

    if (options.snapshotRef) {
      snapshotId = options.snapshotRef.snapshotId;
    } else if (options.snapshotId) {
      snapshotId = options.snapshotId;
    } else if (this.defaultSnapshotId) {
      snapshotId = this.defaultSnapshotId;
    } else {
      throw new Error(
        'No snapshot specified. Provide snapshotRef, snapshotId, or set defaultSnapshotId.'
      );
    }

    // Query events from snapshot
    const events = await this.storage.querySnapshotEvents(
      snapshotId,
      options.queryOptions || {}
    );

    return events;
  }

  /**
   * Read events for a specific token
   *
   * @param tokenAddress - Token address to filter by
   * @param options - Read options
   * @returns Array of canonical events for the token
   */
  async readTokenEvents(
    tokenAddress: string,
    options: DeterministicReadOptions = {}
  ): Promise<CanonicalEvent[]> {
    return this.readEvents({
      ...options,
      queryOptions: {
        ...options.queryOptions,
        tokenAddresses: [tokenAddress],
      },
    });
  }

  /**
   * Read events of a specific type
   *
   * @param eventType - Event type to filter by
   * @param options - Read options
   * @returns Array of canonical events of the specified type
   */
  async readEventType(
    eventType: string,
    options: DeterministicReadOptions = {}
  ): Promise<CanonicalEvent[]> {
    return this.readEvents({
      ...options,
      queryOptions: {
        ...options.queryOptions,
        eventTypes: [eventType],
      },
    });
  }

  /**
   * Read events in a time range
   *
   * @param from - Start time (ISO string)
   * @param to - End time (ISO string)
   * @param options - Read options
   * @returns Array of canonical events in the time range
   */
  async readTimeRange(
    from: string,
    to: string,
    options: DeterministicReadOptions = {}
  ): Promise<CanonicalEvent[]> {
    return this.readEvents({
      ...options,
      queryOptions: {
        ...options.queryOptions,
        from,
        to,
      },
    });
  }
}

/**
 * Create a deterministic reader with a default snapshot
 *
 * @param storage - Snapshot storage backend
 * @param snapshotId - Default snapshot ID to use
 * @returns DeterministicDataReader instance
 */
export function createDeterministicReader(
  storage: SnapshotStorage,
  snapshotId?: string
): DeterministicDataReader {
  return new DeterministicDataReader(storage, snapshotId);
}

