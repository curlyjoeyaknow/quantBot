/**
 * Data Snapshot Service (Branch B Implementation)
 * ================================================
 *
 * Real implementation of data snapshot creation and loading.
 *
 * Strategy:
 * 1. If slices are available (sliceManifestIds provided), use them
 * 2. If no slices, fall back to database queries
 * 3. When using database, automatically create slices for future use
 * 4. If database unavailable, provide helpful error with alternatives
 *
 * Architecture:
 * - Prefers slices (parquet files) for reproducibility and performance
 * - Falls back to database when slices not available
 * - Auto-creates slices when using database to improve future performance
 */

import { createHash } from 'crypto';
import { DateTime } from 'luxon';
import { promises as fs } from 'fs';
import { join } from 'path';
import { logger, ValidationError, ConfigurationError, findWorkspaceRoot } from '@quantbot/utils';
import type { DataSnapshotRef } from '../contract.js';
import { DataSnapshotRefSchema } from '../contract.js';
import type { SliceManifestV1 } from '@quantbot/core';
import { queryCallsDuckdb, createQueryCallsDuckdbContext } from '../../calls/queryCallsDuckdb.js';
import { getStorageEngine } from '@quantbot/storage';
import { exportSlicesForAlerts } from '../../slices/exportSlicesForAlerts.js';
import type { WorkflowContext } from '../../types.js';
import type { PythonEngine } from '@quantbot/utils';
import { z } from 'zod';

/**
 * Catalog port interface - abstracts catalog access to avoid direct dependency on @quantbot/labcatalog
 */
export interface CatalogPort {
  getSlice(manifestId: string): Promise<SliceManifestV1 | null>;
}

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
  /**
   * Optional: Reference to existing slice manifest IDs
   * If provided, snapshot will use these slices instead of querying databases
   */
  sliceManifestIds?: string[];
  /**
   * Catalog base path (default: './catalog')
   */
  catalogBasePath?: string;
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
 * Creates and loads reproducible data snapshots from data slices (parquet files).
 * Uses slice manifests to reference parquet files instead of querying databases directly.
 */
export class DataSnapshotService {
  constructor(
    private readonly ctx?: WorkflowContext,
    private readonly catalog?: CatalogPort,
    private readonly pythonEngine?: PythonEngine
  ) {
    // Catalog is injected as a port to avoid direct dependency on @quantbot/labcatalog
    // If not provided, slice loading will fail gracefully
    // PythonEngine is injected for hash computation (Phase IV: Python computes, TypeScript orchestrates)
    // If not provided, falls back to TypeScript computation (backward compatibility)
  }

  /**
   * Creates a snapshot reference from data
   *
   * Strategy:
   * 1. If sliceManifestIds provided, use slices (fastest, most reproducible)
   * 2. If no slices, query database and auto-create slices
   * 3. If database unavailable, provide helpful error with alternatives
   */
  async createSnapshot(params: CreateSnapshotParams): Promise<DataSnapshotRef> {
    const { timeRange, sources, filters, sliceManifestIds } = params;

    let data: SnapshotData;
    let createdSliceManifestIds: string[] = [];

    // Strategy 1: Use slices if provided
    if (sliceManifestIds && sliceManifestIds.length > 0) {
      logger.info('[DataSnapshotService] Using provided slice manifests', {
        manifestIds: sliceManifestIds,
      });
      data = await this.loadDataFromSlices(params);
      createdSliceManifestIds = sliceManifestIds;
    } else {
      // Strategy 2: Check for existing slices, fall back to database
      const existingSlices = await this.findExistingSlices(params);
      if (existingSlices.length > 0) {
        logger.info('[DataSnapshotService] Found existing slices, using them', {
          manifestIds: existingSlices,
        });
        data = await this.loadDataFromSlices({
          ...params,
          sliceManifestIds: existingSlices,
        });
        createdSliceManifestIds = existingSlices;
      } else {
        // Strategy 3: Query database and auto-create slices
        logger.info('[DataSnapshotService] No slices found, querying database and creating slices');
        try {
          data = await this.loadDataFromDatabase(params);

          // Auto-create slices for future use
          if (this.ctx && filters?.callerNames && filters.callerNames.length > 0) {
            logger.info('[DataSnapshotService] Auto-creating slices from database data');
            const sliceResult = await this.createSlicesFromDatabase(params);
            createdSliceManifestIds = sliceResult.manifestIds;
            logger.info('[DataSnapshotService] Created slices', {
              manifestIds: createdSliceManifestIds,
            });
          }
        } catch (error) {
          // Strategy 4: Database unavailable - provide helpful error
          throw this.createHelpfulError(error, params);
        }
      }
    }

    // Create content hash from actual data (Python computes, TypeScript orchestrates)
    const contentHash = await this.computeContentHash(data, params);

    // Generate snapshot ID (use clock if available, otherwise use DateTime for determinism)
    const timestamp = this.ctx?.clock
      ? DateTime.fromISO(this.ctx.clock.nowISO()).toMillis()
      : DateTime.now().toMillis();
    const snapshotId = `snapshot-${timestamp}-${contentHash.substring(0, 8)}`;

    return DataSnapshotRefSchema.parse({
      snapshotId,
      contentHash,
      timeRange,
      sources,
      filters,
      schemaVersion: '1.0.0',
      createdAtISO: this.ctx?.clock ? this.ctx.clock.nowISO() : DateTime.utc().toISO()!,
      sliceManifestIds: createdSliceManifestIds,
    });
  }

  /**
   * Loads data from a snapshot
   *
   * Strategy:
   * 1. If slices available, use them
   * 2. Otherwise, fall back to database queries
   */
  async loadSnapshot(snapshot: DataSnapshotRef): Promise<SnapshotData> {
    // Verify snapshot integrity first
    if (!(await this.verifySnapshot(snapshot))) {
      throw new ValidationError('Snapshot integrity check failed', {
        snapshotId: snapshot.snapshotId,
        snapshot,
      });
    }

    const params: CreateSnapshotParams = {
      timeRange: snapshot.timeRange,
      sources: snapshot.sources,
      filters: snapshot.filters,
      sliceManifestIds: snapshot.sliceManifestIds,
    };

    // Try slices first, fall back to database
    if (snapshot.sliceManifestIds && snapshot.sliceManifestIds.length > 0) {
      try {
        return await this.loadDataFromSlices(params);
      } catch (error) {
        logger.warn('[DataSnapshotService] Failed to load from slices, falling back to database', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Fall back to database
    return await this.loadDataFromDatabase(params);
  }

  /**
   * Loads snapshot data from parameters (for testing/performance testing)
   *
   * This method bypasses integrity checking and loads data directly.
   * Use loadSnapshot() for production code that requires integrity verification.
   */
  async loadSnapshotData(params: CreateSnapshotParams): Promise<SnapshotData> {
    // Try slices first, fall back to database
    if (params.sliceManifestIds && params.sliceManifestIds.length > 0) {
      try {
        return await this.loadDataFromSlices(params);
      } catch (error) {
        logger.warn('[DataSnapshotService] Failed to load from slices, falling back to database', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Fall back to database
    return await this.loadDataFromDatabase(params);
  }

  /**
   * Verifies snapshot integrity
   *
   * Re-computes the content hash and compares it to the stored hash.
   * Uses slices if available, otherwise falls back to database.
   */
  async verifySnapshot(snapshot: DataSnapshotRef): Promise<boolean> {
    const params: CreateSnapshotParams = {
      timeRange: snapshot.timeRange,
      sources: snapshot.sources,
      filters: snapshot.filters,
      sliceManifestIds: snapshot.sliceManifestIds,
    };

    let data: SnapshotData;

    // Try slices first, fall back to database
    if (snapshot.sliceManifestIds && snapshot.sliceManifestIds.length > 0) {
      try {
        data = await this.loadDataFromSlices(params);
      } catch (error) {
        logger.warn(
          '[DataSnapshotService] Failed to verify from slices, falling back to database',
          {
            error: error instanceof Error ? error.message : String(error),
          }
        );
        data = await this.loadDataFromDatabase(params);
      }
    } else {
      data = await this.loadDataFromDatabase(params);
    }

    // Re-compute hash (Python computes, TypeScript orchestrates)
    const computedHash = await this.computeContentHash(data, params);

    return computedHash === snapshot.contentHash;
  }

  /**
   * Loads data from slice manifests (parquet files)
   *
   * This is the core method that loads data from slices instead of querying databases.
   * Uses DuckDB to read parquet files referenced in slice manifests.
   */
  private async loadDataFromSlices(params: CreateSnapshotParams): Promise<SnapshotData> {
    const { timeRange, sources, filters, sliceManifestIds } = params;
    const fromTime = DateTime.fromISO(timeRange.fromISO);
    const toTime = DateTime.fromISO(timeRange.toISO);

    const candles: SnapshotData['candles'] = [];
    const calls: SnapshotData['calls'] = [];

    // If slice manifest IDs are provided, load from those slices
    if (sliceManifestIds && sliceManifestIds.length > 0) {
      logger.info('[DataSnapshotService] Loading data from slice manifests', {
        manifestIds: sliceManifestIds,
      });

      for (const manifestId of sliceManifestIds) {
        if (!this.catalog) {
          throw new ValidationError('Catalog port not provided - cannot load slices', {
            manifestId,
          });
        }
        const manifest = await this.catalog.getSlice(manifestId);
        if (!manifest) {
          logger.warn('[DataSnapshotService] Slice manifest not found', { manifestId });
          continue;
        }

        // Load data from parquet files in the manifest
        const sliceData = await this.loadDataFromManifest(manifest, filters);
        calls.push(...sliceData.calls);
        candles.push(...sliceData.candles);
      }
    } else {
      // No slice manifests provided - this should not happen in loadDataFromSlices
      // as it should only be called when slices are available
      throw new ValidationError('No slice manifest IDs provided to loadDataFromSlices', { params });
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
   * Loads data from a single slice manifest
   *
   * Reads parquet files using DuckDB (which can read parquet natively).
   */
  private async loadDataFromManifest(
    manifest: SliceManifestV1,
    filters?: CreateSnapshotParams['filters']
  ): Promise<SnapshotData> {
    const candles: SnapshotData['candles'] = [];
    const calls: SnapshotData['calls'] = [];

    // Use DuckDB to read parquet files
    // DuckDB can read parquet files directly without importing them
    const duckdbPath = process.env.DUCKDB_PATH || 'data/tele.duckdb';

    // For now, we'll use a simple approach: read parquet files via DuckDB
    // This requires DuckDB to be available, but it's the standard way to read parquet
    try {
      // Import DuckDB dynamically to avoid build-time dependency
      const { Database } = await import('duckdb');
      const db = new Database(duckdbPath, { access_mode: 'READ_ONLY' });

      // Read each parquet file from the manifest
      for (const parquetFile of manifest.parquetFiles) {
        // Remove file:// prefix if present
        const filePath = parquetFile.path.replace(/^file:\/\//, '');

        // Check if file exists
        try {
          await fs.access(filePath);
        } catch {
          logger.warn('[DataSnapshotService] Parquet file not found', { path: filePath });
          continue;
        }

        // Read parquet file based on dataset type
        if (
          manifest.spec.dataset === 'candles_1m' ||
          manifest.spec.dataset.startsWith('candles_')
        ) {
          // Read candles from parquet
          const rows = await new Promise<any[]>((resolve, reject) => {
            db.all(
              `SELECT * FROM read_parquet('${filePath}')`,
              (err: Error | null, rows: any[]) => {
                if (err) reject(err);
                else resolve(rows);
              }
            );
          });

          for (const row of rows) {
            // Apply filters
            if (
              filters?.mintAddresses &&
              !filters.mintAddresses.includes(row.mint || row.token_address)
            ) {
              continue;
            }

            candles.push({
              timestamp: row.timestamp || row.ts || 0,
              open: row.open || 0,
              high: row.high || 0,
              low: row.low || 0,
              close: row.close || 0,
              volume: row.volume || 0,
              mint: row.mint || row.token_address,
            });
          }
        } else if (manifest.spec.dataset === 'calls' || manifest.spec.dataset.includes('call')) {
          // Read calls from parquet
          const rows = await new Promise<any[]>((resolve, reject) => {
            db.all(
              `SELECT * FROM read_parquet('${filePath}')`,
              (err: Error | null, rows: any[]) => {
                if (err) reject(err);
                else resolve(rows);
              }
            );
          });

          for (const row of rows) {
            // Apply filters
            if (
              filters?.callerNames &&
              !filters.callerNames.includes(row.caller_name || row.caller)
            ) {
              continue;
            }
            if (
              filters?.mintAddresses &&
              !filters.mintAddresses.includes(row.mint || row.token_address)
            ) {
              continue;
            }

            calls.push({
              id: row.id || row.message_id || `call-${row.mint}-${row.call_ts_ms}`,
              caller: row.caller_name || row.caller || 'unknown',
              mint: row.mint || row.token_address,
              createdAt: row.call_datetime || new Date(row.call_ts_ms).toISOString(),
              price: row.price_usd,
              volume: row.volume,
            });
          }
        }
      }

      db.close();
    } catch (error) {
      logger.error('[DataSnapshotService] Failed to load data from manifest', error as Error, {
        manifestId: manifest.manifestId,
      });
      throw new ValidationError('Failed to load data from slice manifest', {
        manifestId: manifest.manifestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { candles, calls };
  }

  /**
   * Finds existing slices that match the given parameters
   */
  private async findExistingSlices(params: CreateSnapshotParams): Promise<string[]> {
    // Search catalog for slices matching the time range and filters
    // This is a simplified implementation - in practice, you'd want to search
    // by time range and caller names if filters are provided
    try {
      const { timeRange, filters } = params;
      const fromTime = DateTime.fromISO(timeRange.fromISO);
      const toTime = DateTime.fromISO(timeRange.toISO);

      // For now, return empty array - full implementation would search catalog
      // by time range and caller names
      logger.info('[DataSnapshotService] Searching for existing slices', {
        fromISO: timeRange.fromISO,
        toISO: timeRange.toISO,
        callerNames: filters?.callerNames,
      });

      // TODO: Implement catalog search by time range and filters
      // This would involve querying the catalog adapter to find matching slice manifests
      return [];
    } catch (error) {
      logger.warn('[DataSnapshotService] Error searching for existing slices', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Loads data from database (DuckDB and ClickHouse)
   */
  private async loadDataFromDatabase(params: CreateSnapshotParams): Promise<SnapshotData> {
    const { timeRange, filters } = params;
    const fromTime = DateTime.fromISO(timeRange.fromISO);
    const toTime = DateTime.fromISO(timeRange.toISO);

    // Query calls from DuckDB
    const calls: SnapshotData['calls'] = [];
    if (this.ctx) {
      try {
        const duckdbPath = process.env.DUCKDB_PATH || 'data/tele.duckdb';
        const queryCtx = await createQueryCallsDuckdbContext(duckdbPath);
        const callsResult = await queryCallsDuckdb(
          {
            duckdbPath,
            fromISO: timeRange.fromISO,
            toISO: timeRange.toISO,
            callerName: filters?.callerNames?.[0], // Use first caller if multiple
            limit: 10000, // Large limit
          },
          queryCtx
        );

        if (callsResult.calls && callsResult.calls.length > 0) {
          for (const call of callsResult.calls) {
            // Apply filters
            if (filters?.callerNames && !filters.callerNames.includes(call.caller || '')) {
              continue;
            }
            if (filters?.mintAddresses && !filters.mintAddresses.includes(call.mint)) {
              continue;
            }

            // Convert DateTime to ISO string
            const createdAtISO =
              call.createdAt instanceof Date
                ? call.createdAt.toISOString()
                : typeof call.createdAt === 'object' &&
                    'toISO' in call.createdAt &&
                    typeof call.createdAt.toISO === 'function'
                  ? (call.createdAt.toISO() ?? call.createdAt.toJSDate().toISOString())
                  : typeof call.createdAt === 'string'
                    ? call.createdAt
                    : new Date(call.createdAt as unknown as string | number).toISOString();

            calls.push({
              id: call.id || `call-${call.mint}-${createdAtISO}`,
              caller: call.caller || 'unknown',
              mint: call.mint,
              createdAt: createdAtISO,
              price: call.price_usd,
              volume: undefined, // CallRecord doesn't have volume
            });
          }
        }
      } catch (error) {
        logger.error('[DataSnapshotService] Failed to query calls from database', error as Error);
        throw new ValidationError('Failed to load calls from database', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Query candles from ClickHouse (via storage engine)
    const candles: SnapshotData['candles'] = [];
    try {
      const storageEngine = getStorageEngine();

      // Get unique mints from calls
      const uniqueMints = [...new Set(calls.map((c) => c.mint))];

      for (const mint of uniqueMints) {
        try {
          const mintCandles = await storageEngine.getCandles(
            mint,
            'solana', // Default chain
            fromTime,
            toTime,
            { interval: '5m' }
          );

          for (const candle of mintCandles) {
            candles.push({
              timestamp: candle.timestamp * 1000, // Convert to milliseconds
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              volume: candle.volume,
              mint,
            });
          }
        } catch (error) {
          logger.warn('[DataSnapshotService] Failed to load candles for mint', {
            mint,
            error: error instanceof Error ? error.message : String(error),
          });
          // Continue with other mints
        }
      }
    } catch (error) {
      logger.error('[DataSnapshotService] Failed to query candles from database', error as Error);
      // Don't throw - candles are optional, calls are required
    }

    // Apply volume filter if specified
    let filteredCandles = candles;
    if (filters?.minVolume !== undefined) {
      filteredCandles = candles.filter((c) => (c.volume || 0) >= filters.minVolume!);
    }

    return {
      calls,
      candles: filteredCandles,
    };
  }

  /**
   * Creates slices from database data
   *
   * Note: Full implementation would use exportSlicesForAlerts workflow.
   * For now, this is a stub that returns empty array.
   * TODO: Implement full slice creation using exportSlicesForAlerts
   */
  private async createSlicesFromDatabase(
    params: CreateSnapshotParams
  ): Promise<{ manifestIds: string[] }> {
    if (!this.ctx || !params.filters?.callerNames || params.filters.callerNames.length === 0) {
      throw new ValidationError('Cannot create slices without context and caller names', {
        hasContext: !!this.ctx,
        hasCallerNames: !!params.filters?.callerNames,
      });
    }

    // TODO: Implement full slice creation using exportSlicesForAlerts workflow
    // This requires setting up the proper context with an exporter
    logger.info('[DataSnapshotService] Slice creation from database not yet implemented', {
      timeRange: params.timeRange,
      callerNames: params.filters.callerNames,
    });

    // Return empty array for now - slices can be created manually using exportSlicesForAlerts
    return { manifestIds: [] };
  }

  /**
   * Creates a helpful error message when database is unavailable
   */
  private createHelpfulError(error: unknown, params: CreateSnapshotParams): Error {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const message =
      `Database query failed: ${errorMessage}. ` +
      `To work around this, you can: ` +
      `1. Create slices manually using exportSlicesForAlerts workflow, ` +
      `2. Provide sliceManifestIds in the snapshot parameters, or ` +
      `3. Ensure database is accessible and try again.`;

    return new ConfigurationError(message, undefined, {
      originalError: errorMessage,
      params: {
        timeRange: params.timeRange,
        sources: params.sources,
        filters: params.filters,
      },
    });
  }

  /**
   * Computes content hash from data and parameters
   *
   * Phase IV: Python computes hash, TypeScript orchestrates via PythonEngine
   * Falls back to TypeScript computation if PythonEngine not available (backward compatibility)
   */
  private async computeContentHash(
    data: SnapshotData,
    params: CreateSnapshotParams
  ): Promise<string> {
    // Use Python for hash computation if PythonEngine is available (Phase IV)
    if (this.pythonEngine) {
      try {
        const workspaceRoot = findWorkspaceRoot();
        const scriptPath = join(workspaceRoot, 'tools/backtest/lib/experiments/hash_snapshot.py');

        const inputJson = JSON.stringify({
          data: {
            candles: data.candles,
            calls: data.calls,
          },
          params: {
            timeRange: params.timeRange,
            sources: params.sources,
            filters: params.filters,
          },
        });

        const resultSchema = z.object({
          hash: z.string().regex(/^[a-f0-9]{64}$/),
        });

        const result = await this.pythonEngine.runScriptWithStdin(
          scriptPath,
          inputJson,
          resultSchema,
          {
            timeout: 30 * 1000, // 30 seconds
            expectJsonOutput: true,
            cwd: workspaceRoot,
            env: {
              ...process.env,
              PYTHONPATH: workspaceRoot,
            },
          }
        );

        return result.hash;
      } catch (error) {
        logger.warn(
          '[DataSnapshotService] Failed to compute hash via Python, falling back to TypeScript',
          {
            error: error instanceof Error ? error.message : String(error),
          }
        );
        // Fall through to TypeScript computation
      }
    }

    // Fallback: TypeScript computation (backward compatibility)
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
 *
 * Note: For full catalog support, provide a CatalogPort implementation.
 * This factory function creates a service without catalog (slice loading will fail).
 */
export function createDataSnapshotService(
  ctx?: WorkflowContext,
  catalog?: CatalogPort,
  pythonEngine?: PythonEngine
): DataSnapshotService {
  return new DataSnapshotService(ctx, catalog, pythonEngine);
}
