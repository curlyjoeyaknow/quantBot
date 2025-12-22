/**
 * Data Snapshot Service (Branch B Implementation)
 * ================================================
 *
 * Real implementation of data snapshot creation and loading.
 * Replaces MockDataSnapshotService with actual data source integration.
 */

import { createHash } from 'crypto';
import { DateTime } from 'luxon';
import type { DataSnapshotRef } from '../contract.js';
import { DataSnapshotRefSchema } from '../contract.js';
import { queryCallsDuckdb } from '../../calls/queryCallsDuckdb.js';
import { getStorageEngine } from '@quantbot/storage';
import type { WorkflowContext } from '../../types.js';

/**
 * Snapshot creation parameters
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
 * Data Snapshot Service
 *
 * Creates and loads reproducible data snapshots from real data sources.
 */
export class DataSnapshotService {
  constructor(private readonly ctx?: WorkflowContext) {}

  /**
   * Creates a snapshot reference from data sources
   *
   * This queries actual data and creates a content hash from the data itself,
   * not just the parameters. This ensures the hash reflects the actual data content.
   */
  async createSnapshot(params: CreateSnapshotParams): Promise<DataSnapshotRef> {
    const { timeRange, sources, filters } = params;

    // Load actual data to compute content hash
    const data = await this.loadDataForSnapshot(params);

    // Create content hash from actual data
    const contentHash = this.computeContentHash(data, params);

    // Generate snapshot ID
    const snapshotId = `snapshot-${Date.now()}-${contentHash.substring(0, 8)}`;

    return DataSnapshotRefSchema.parse({
      snapshotId,
      contentHash,
      timeRange,
      sources,
      filters,
      schemaVersion: '1.0.0',
      createdAtISO: new Date().toISOString(),
    });
  }

  /**
   * Loads data from a snapshot
   *
   * Re-queries the data sources using the snapshot parameters to ensure
   * we get the same data that was used to create the snapshot.
   */
  async loadSnapshot(snapshot: DataSnapshotRef): Promise<SnapshotData> {
    // Verify snapshot integrity first
    if (!this.verifySnapshot(snapshot)) {
      throw new Error(`Snapshot integrity check failed: ${snapshot.snapshotId}`);
    }

    // Load data using snapshot parameters
    return this.loadDataForSnapshot({
      timeRange: snapshot.timeRange,
      sources: snapshot.sources,
      filters: snapshot.filters,
    });
  }

  /**
   * Verifies snapshot integrity
   *
   * Re-computes the content hash and compares it to the stored hash.
   */
  async verifySnapshot(snapshot: DataSnapshotRef): Promise<boolean> {
    // Load data using snapshot parameters
    const data = await this.loadDataForSnapshot({
      timeRange: snapshot.timeRange,
      sources: snapshot.sources,
      filters: snapshot.filters,
    });

    // Re-compute hash
    const computedHash = this.computeContentHash(data, {
      timeRange: snapshot.timeRange,
      sources: snapshot.sources,
      filters: snapshot.filters,
    });

    return computedHash === snapshot.contentHash;
  }

  /**
   * Loads data for snapshot creation/verification
   */
  private async loadDataForSnapshot(params: CreateSnapshotParams): Promise<SnapshotData> {
    const { timeRange, sources, filters } = params;
    const fromTime = DateTime.fromISO(timeRange.fromISO);
    const toTime = DateTime.fromISO(timeRange.toISO);

    const candles: SnapshotData['candles'] = [];
    const calls: SnapshotData['calls'] = [];

    // Load calls from DuckDB
    if (filters?.callerNames && filters.callerNames.length > 0) {
      // Query for each caller name (queryCallsDuckdb only supports single callerName)
      for (const callerName of filters.callerNames) {
        const duckdbPath = process.env.DUCKDB_PATH || 'data/tele.duckdb';
        const callsResult = await queryCallsDuckdb(
          {
            duckdbPath,
            fromISO: timeRange.fromISO,
            toISO: timeRange.toISO,
            callerName,
            limit: 10000,
          },
          this.ctx as any // Type assertion needed - context should have services
        );

        for (const call of callsResult.calls) {
          // Handle both Date and DateTime objects
          const createdAtISO =
            call.createdAt instanceof Date
              ? call.createdAt.toISOString()
              : typeof call.createdAt === 'object' &&
                  'toISO' in call.createdAt &&
                  typeof call.createdAt.toISO === 'function'
                ? (call.createdAt.toISO() ?? call.createdAt.toJSDate().toISOString())
                : typeof call.createdAt === 'string'
                  ? call.createdAt
                  : call.createdAt instanceof Date
                    ? call.createdAt.toISOString()
                    : new Date(call.createdAt as unknown as string | number).toISOString();

          if (!createdAtISO) {
            throw new Error(`Failed to convert createdAt to ISO string for call ${call.id}`);
          }

          calls.push({
            id: call.id || `call-${call.mint}-${createdAtISO}`,
            caller: call.caller || 'unknown',
            mint: call.mint,
            createdAt: createdAtISO,
            price: (call as any).price,
            volume: (call as any).volume,
          });
        }
      }
    }

    // Load candles from storage engine
    const storageEngine = getStorageEngine();
    const uniqueMints = new Set<string>();

    // Collect unique mints from calls
    for (const call of calls) {
      uniqueMints.add(call.mint);
    }

    // Also check filters for mint addresses
    if (filters?.mintAddresses) {
      for (const mint of filters.mintAddresses) {
        uniqueMints.add(mint);
      }
    }

    // Load candles for each mint
    for (const mint of uniqueMints) {
      try {
        const mintCandles = await storageEngine.getCandles(
          mint,
          sources[0]?.chain || 'solana',
          fromTime,
          toTime,
          { interval: '5m' }
        );

        for (const candle of mintCandles) {
          // Ensure timestamp is a number (Unix timestamp in seconds)
          const timestamp =
            typeof candle.timestamp === 'number'
              ? candle.timestamp
              : (candle.timestamp as any) instanceof Date
                ? Math.floor((candle.timestamp as any as Date).getTime() / 1000)
                : parseInt(String(candle.timestamp), 10);

          candles.push({
            timestamp,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume,
            mint,
          });
        }
      } catch (error) {
        // Log but continue - some mints may not have candles
        console.warn(`Failed to load candles for mint ${mint.substring(0, 20)}...`, error);
      }
    }

    // Apply volume filter if specified
    let filteredCandles = candles;
    if (filters?.minVolume !== undefined) {
      filteredCandles = candles.filter((c) => (c.volume || 0) >= filters.minVolume!);
    }

    return {
      candles: filteredCandles,
      calls,
    };
  }

  /**
   * Computes content hash from data and parameters
   */
  private computeContentHash(data: SnapshotData, params: CreateSnapshotParams): string {
    // Create deterministic representation of data
    const dataRepr = {
      params: {
        timeRange: params.timeRange,
        sources: params.sources,
        filters: params.filters,
      },
      data: {
        candles: data.candles.map((c) => ({
          t: c.timestamp,
          o: c.open,
          h: c.high,
          l: c.low,
          c: c.close,
          v: c.volume,
          m: c.mint,
        })),
        calls: data.calls.map((c) => ({
          id: c.id,
          caller: c.caller,
          mint: c.mint,
          createdAt: c.createdAt,
          // price and volume are optional and may not exist
          price: c.price,
          volume: c.volume,
        })),
      },
    };

    // Sort for determinism
    dataRepr.data.candles.sort((a, b) => {
      if (a.t !== b.t) return a.t - b.t;
      return (a.m || '').localeCompare(b.m || '');
    });
    dataRepr.data.calls.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    // Compute hash
    const json = JSON.stringify(dataRepr);
    return createHash('sha256').update(json).digest('hex');
  }
}

/**
 * Create default DataSnapshotService instance
 */
export function createDataSnapshotService(ctx?: WorkflowContext): DataSnapshotService {
  return new DataSnapshotService(ctx);
}
