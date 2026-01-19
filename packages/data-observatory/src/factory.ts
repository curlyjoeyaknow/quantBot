/**
 * Factory Functions
 *
 * Convenience functions to create observatory components with dependencies wired.
 */

import { getStorageEngine } from '@quantbot/storage';
import { SnapshotManager } from './snapshots/snapshot-manager.js';
import { StorageEventCollector } from './snapshots/event-collector.js';
import { DuckDBSnapshotStorage } from './snapshots/duckdb-storage.js';
import type { SnapshotManager as ISnapshotManager } from './snapshots/snapshot-manager.js';

/**
 * Create a snapshot manager with default dependencies
 *
 * @param duckdbPath - Path to DuckDB database for snapshot storage
 * @param callsDuckdbPath - Optional path to DuckDB database for querying calls (defaults to duckdbPath)
 * @returns Configured snapshot manager
 */
export function createSnapshotManager(
  duckdbPath: string,
  callsDuckdbPath?: string
): ISnapshotManager {
  const storage = getStorageEngine();
  const eventCollector = new StorageEventCollector(storage, {
    duckdbPath: callsDuckdbPath || duckdbPath,
  });
  const snapshotStorage = new DuckDBSnapshotStorage(duckdbPath);

  return new SnapshotManager(snapshotStorage, eventCollector);
}
