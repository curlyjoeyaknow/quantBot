/**
 * Branch B Integration
 * ====================
 *
 * Adapter layer that integrates Branch B's data observatory package
 * with Branch A's research OS contracts.
 *
 * This file provides type adapters and utilities to bridge between:
 * - Branch B: @quantbot/data-observatory (canonical events, snapshots)
 * - Branch A: Research OS contracts (DataSnapshotRef, SimulationRequest)
 */

import type { DataSnapshotRef as BranchBDataSnapshotRef } from '@quantbot/data-observatory';
import type { DataSnapshotRef as BranchADataSnapshotRef } from './contract.js';

/**
 * Convert Branch B DataSnapshotRef to Branch A format
 *
 * This adapter ensures compatibility between the two formats.
 */
export function adaptBranchBToBranchA(
  branchBRef: BranchBDataSnapshotRef
): BranchADataSnapshotRef {
  // Extract sources from Branch B spec
  const sources = branchBRef.spec.filters?.venues?.map((venue) => ({
    venue,
    chain: branchBRef.spec.filters?.chain,
  })) || [];

  return {
    snapshotId: branchBRef.snapshotId,
    contentHash: branchBRef.contentHash,
    timeRange: {
      fromISO: branchBRef.spec.from,
      toISO: branchBRef.spec.to,
    },
    sources: sources.length > 0 ? sources : [{ venue: 'unknown' }],
    filters: {
      callerNames: branchBRef.spec.filters?.callerNames,
      mintAddresses: branchBRef.spec.filters?.tokenAddresses,
    },
    schemaVersion: '1.0.0',
    createdAtISO: branchBRef.createdAt,
  };
}

/**
 * Convert Branch A DataSnapshotRef to Branch B format (for queries)
 *
 * This is used when we need to query Branch B using Branch A's ref.
 */
export function adaptBranchAToBranchB(
  branchARef: BranchADataSnapshotRef
): { snapshotId: string; from?: string; to?: string; tokenAddresses?: string[] } {
  return {
    snapshotId: branchARef.snapshotId,
    from: branchARef.timeRange.fromISO,
    to: branchARef.timeRange.toISO,
    tokenAddresses: branchARef.filters?.mintAddresses,
  };
}

/**
 * Type guard to check if a DataSnapshotRef is from Branch B
 */
export function isBranchBRef(
  ref: BranchADataSnapshotRef | BranchBDataSnapshotRef
): ref is BranchBDataSnapshotRef {
  return 'spec' in ref && 'manifest' in ref;
}

