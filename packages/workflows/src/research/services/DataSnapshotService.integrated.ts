/**
 * Data Snapshot Service - Integrated Branch B Implementation
 * ==========================================================
 *
 * This is the integrated version that uses Branch B's data observatory package.
 * It replaces the standalone implementation with Branch B integration.
 *
 * Usage:
 * ```typescript
 * import { createDataSnapshotService } from './DataSnapshotService.integrated';
 * const service = createDataSnapshotService('data/snapshots.duckdb', ctx);
 * ```
 */

import { DateTime } from 'luxon';
import type {
  DataSnapshotRef as BranchBDataSnapshotRef,
  SnapshotSpec,
} from '@quantbot/data-observatory';
import { createSnapshotManager } from '@quantbot/data-observatory';
import type { DataSnapshotRef as BranchADataSnapshotRef } from '../contract.js';
import { adaptBranchBToBranchA } from '../integration-branch-b.js';
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
 * Data Snapshot Service (Integrated with Branch B)
 *
 * Uses Branch B's snapshot manager for all snapshot operations.
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

    // Convert Branch B ref to Branch A format using adapter
    return adaptBranchBToBranchA(branchBRef);
  }

  /**
   * Loads data from a snapshot
   *
   * Uses Branch B's querySnapshot to load canonical events,
   * then converts to Branch A's SnapshotData format.
   */
  async loadSnapshot(snapshot: BranchADataSnapshotRef): Promise<SnapshotData> {
    // Query canonical events from Branch B
    const events = await this.snapshotManager.querySnapshot(snapshot.snapshotId, {
      eventTypes: ['candle', 'call'],
      tokenAddresses: snapshot.filters?.mintAddresses,
      from: snapshot.timeRange.fromISO,
      to: snapshot.timeRange.toISO,
    });

    // Convert canonical events to Branch A SnapshotData format
    return this.convertEventsToSnapshotData(events);
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
  private convertToBranchBSpec(params: CreateSnapshotParams): SnapshotSpec {
    // Determine data sources from Branch A sources
    const sources: Array<'calls' | 'ohlcv' | 'trades' | 'metadata' | 'signals' | 'all'> = [];

    // Map venues to sources
    for (const source of params.sources) {
      if (source.venue === 'birdeye') {
        if (!sources.includes('ohlcv')) sources.push('ohlcv');
      }
      if (source.venue === 'pump.fun' || source.venue === 'telegram') {
        if (!sources.includes('calls')) sources.push('calls');
      }
    }

    // Default to 'all' if no sources determined
    if (sources.length === 0) {
      sources.push('all');
    }

    return {
      sources: sources as SnapshotSpec['sources'],
      from: params.timeRange.fromISO,
      to: params.timeRange.toISO,
      filters: {
        chain: params.sources[0]?.chain as
          | 'solana'
          | 'ethereum'
          | 'bsc'
          | 'base'
          | 'monad'
          | 'evm'
          | undefined,
        tokenAddresses: params.filters?.mintAddresses,
        callerNames: params.filters?.callerNames,
        venues: params.sources.map((s) => s.venue),
      },
      name: `snapshot-${DateTime.fromISO(params.timeRange.fromISO).toFormat('yyyy-MM-dd')}`,
    };
  }

  /**
   * Convert canonical events to Branch A SnapshotData format
   */
  private convertEventsToSnapshotData(events: any[]): SnapshotData {
    const candles: SnapshotData['candles'] = [];
    const calls: SnapshotData['calls'] = [];

    for (const event of events) {
      if (event.eventType === 'candle') {
        const candleValue = event.value as any;
        const timestamp = DateTime.fromISO(event.timestamp);
        if (!timestamp.isValid) {
          continue;
        }

        candles.push({
          timestamp: timestamp.toSeconds(),
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
