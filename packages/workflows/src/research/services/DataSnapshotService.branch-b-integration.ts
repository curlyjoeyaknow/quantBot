/**
 * Data Snapshot Service - Branch B Integration
 * ============================================
 *
 * Integration adapter that uses Branch B's data observatory package
 * for snapshot creation and management.
 */

import { DateTime } from 'luxon';
import type { DataSnapshotRef as BranchBDataSnapshotRef } from '@quantbot/data-observatory';
import { createSnapshotManager } from '@quantbot/data-observatory';
import type { DataSnapshotRef as BranchADataSnapshotRef } from '../contract.js';
import type { WorkflowContext } from '../../types.js';

/**
 * Snapshot creation parameters (Branch A format)
 */
export interface CreateSnapshotParams {
  timeRange: {
    fromISO: string;
    toISO: string;
  };
  sources: Array<{
    venue: string;
    chain?: string;
  }>;
  filters?: {
    callerNames?: string[];
    mintAddresses?: string[];
    minVolume?: number;
  };
}

/**
 * Snapshot data loaded from a snapshot
 */
export interface SnapshotData {
  candles: Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    mint?: string;
  }>;
  calls: Array<{
    id: string;
    caller: string;
    mint: string;
    createdAt: string;
    price?: number;
    volume?: number;
  }>;
}

/**
 * Data Snapshot Service (Branch B Integration)
 *
 * Uses Branch B's snapshot manager to create and manage snapshots.
 * Provides adapter methods to convert between Branch A and Branch B formats.
 */
export class DataSnapshotService {
  private snapshotManager;

  constructor(
    private readonly duckdbPath: string = 'data/snapshots.duckdb',
    private readonly ctx?: WorkflowContext
  ) {
    this.snapshotManager = createSnapshotManager(duckdbPath);
  }

  /**
   * Creates a snapshot reference using Branch B's snapshot manager
   */
  async createSnapshot(params: CreateSnapshotParams): Promise<BranchADataSnapshotRef> {
    // Convert Branch A params to Branch B spec
    const branchBSpec = this.convertToBranchBSpec(params);

    // Create snapshot using Branch B
    const branchBRef = await this.snapshotManager.createSnapshot(branchBSpec);

    // Convert Branch B ref to Branch A format
    return this.convertToBranchARef(branchBRef);
  }

  /**
   * Loads data from a snapshot
   *
   * Uses Branch B's querySnapshot to load canonical events,
   * then converts to Branch A's SnapshotData format.
   */
  async loadSnapshot(snapshot: BranchADataSnapshotRef): Promise<SnapshotData> {
    // First, convert Branch A ref back to Branch B format (if we stored the mapping)
    // For now, we'll need to query using the snapshot parameters

    // Query canonical events from Branch B
    const events = await this.snapshotManager.querySnapshot(snapshot.snapshotId, {
      eventTypes: ['candle', 'call'],
      tokenAddresses: snapshot.filters?.mintAddresses,
      from: snapshot.timeRange.fromISO,
      to: snapshot.timeRange.toISO,
    });

    // Convert canonical events to Branch A SnapshotData format
    const candles: SnapshotData['candles'] = [];
    const calls: SnapshotData['calls'] = [];

    for (const event of events) {
      if (event.eventType === 'candle') {
        const candleValue = event.value as any;
        candles.push({
          timestamp: DateTime.fromISO(event.timestamp).toSeconds(),
          open: candleValue.open,
          high: candleValue.high,
          low: candleValue.low,
          close: candleValue.close,
          volume: candleValue.volume,
          mint: event.asset,
        });
      } else if (event.eventType === 'call') {
        const callValue = event.value as any;
        calls.push({
          id: `${event.asset}-${event.timestamp}`,
          caller: callValue.callerName || 'unknown',
          mint: event.asset,
          createdAt: event.timestamp,
          price: callValue.price,
          volume: callValue.value?.volume,
        });
      }
    }

    return { candles, calls };
  }

  /**
   * Verifies snapshot integrity using Branch B's verification
   */
  async verifySnapshot(snapshot: BranchADataSnapshotRef): Promise<boolean> {
    // Load the snapshot from Branch B
    const branchBRef = await this.snapshotManager.getSnapshot(snapshot.snapshotId);
    if (!branchBRef) {
      return false;
    }

    // Verify content hash matches
    return branchBRef.contentHash === snapshot.contentHash;
  }

  /**
   * Convert Branch A CreateSnapshotParams to Branch B SnapshotSpec
   */
  private convertToBranchBSpec(params: CreateSnapshotParams) {
    // Determine data sources from Branch A sources
    const sources: Array<'calls' | 'ohlcv' | 'trades' | 'metadata' | 'signals' | 'all'> = [];
    
    // Map venues to sources (heuristic)
    for (const source of params.sources) {
      if (source.venue === 'birdeye' || source.venue === 'pump.fun') {
        sources.push('ohlcv');
        sources.push('calls');
      } else {
        sources.push('calls');
      }
    }

    // Deduplicate sources
    const uniqueSources = Array.from(new Set(sources));
    if (uniqueSources.length === 0) {
      uniqueSources.push('all');
    }

    return {
      sources: uniqueSources,
      from: params.timeRange.fromISO,
      to: params.timeRange.toISO,
      filters: {
        chain: params.sources[0]?.chain as 'solana' | 'ethereum' | 'bsc' | 'base' | 'monad' | 'evm' | undefined,
        tokenAddresses: params.filters?.mintAddresses,
        callerNames: params.filters?.callerNames,
        venues: params.sources.map((s) => s.venue),
      },
      name: `snapshot-${params.timeRange.fromISO}-${params.timeRange.toISO}`,
    };
  }

  /**
   * Convert Branch B DataSnapshotRef to Branch A format
   */
  private convertToBranchARef(branchBRef: BranchBDataSnapshotRef): BranchADataSnapshotRef {
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
        // minVolume not directly mappable from Branch B
      },
      schemaVersion: '1.0.0',
      createdAtISO: branchBRef.createdAt,
    };
  }
}

/**
 * Create default DataSnapshotService instance
 */
export function createDataSnapshotService(
  duckdbPath?: string,
  ctx?: WorkflowContext
): DataSnapshotService {
  return new DataSnapshotService(duckdbPath, ctx);
}

