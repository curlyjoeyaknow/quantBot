/**
 * Catalog API - High-level interface for catalog operations
 *
 * Provides simple API: putSlice, getSlice, putRun, listRuns
 * Uses adapters for storage operations.
 */

import { DateTime } from 'luxon';
import type { SliceManifestV1 } from '@quantbot/core';
import type { CatalogAdapter } from './adapters.js';
import type { RunManifest, CatalogRootManifest } from './manifest.js';
import {
  getCatalogPaths,
  getSliceManifestPath,
  getRunDirPath,
  getRunManifestPath,
  parseRunDirPath,
} from './layout.js';
import { generateSliceManifestId } from './content-address.js';
import {
  createCatalogRootManifest,
  createRunManifest,
  CatalogRootManifestSchema,
  RunManifestSchema,
} from './manifest.js';

/**
 * Options for listing runs
 */
export interface ListRunsOptions {
  strategyId?: string;
  status?: 'pending' | 'running' | 'completed' | 'failed';
  limit?: number;
  offset?: number;
}

/**
 * Catalog API
 *
 * Main interface for catalog operations.
 */
export class Catalog {
  private readonly adapter: CatalogAdapter;
  private readonly basePath: string;

  constructor(adapter: CatalogAdapter, basePath: string = './catalog') {
    this.adapter = adapter;
    this.basePath = basePath;
  }

  /**
   * Store a slice manifest in the catalog
   *
   * Writes manifest to appropriate location and updates root manifest.
   *
   * @param manifest - Slice manifest
   * @returns Manifest ID
   */
  async putSlice(manifest: SliceManifestV1): Promise<string> {
    // Generate deterministic manifest ID
    const manifestId = generateSliceManifestId(manifest);

    // Determine manifest path
    const tokenId = manifest.spec.tokenIds?.[0]; // Use first token if available
    const manifestPath = getSliceManifestPath(manifestId, tokenId, this.basePath);

    // Write manifest
    await this.adapter.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    // Update root catalog manifest
    await this.updateRootManifest((root) => {
      root.slices[manifestId] = {
        manifestId,
        tokenId,
        createdAtIso: manifest.createdAtIso,
        dataset: manifest.spec.dataset,
        chain: manifest.spec.chain,
        timeRange: manifest.spec.timeRange,
        fileCount: manifest.parquetFiles.length,
        totalRows: manifest.summary.totalRows,
        totalBytes: manifest.summary.totalBytes,
      };
      root.updatedAtIso = DateTime.now().toISO()!;
      return root;
    });

    return manifestId;
  }

  /**
   * Retrieve a slice manifest by ID
   *
   * @param manifestId - Manifest ID
   * @returns Slice manifest or null if not found
   */
  async getSlice(manifestId: string): Promise<SliceManifestV1 | null> {
    // Try to find manifest in root catalog first
    const root = await this.getRootManifest();
    const sliceMeta = root.slices[manifestId];

    if (!sliceMeta) {
      return null;
    }

    // Try token-specific path first, then root bars directory
    let manifestPath: string | null = null;
    if (sliceMeta.tokenId) {
      const tokenPath = getSliceManifestPath(manifestId, sliceMeta.tokenId, this.basePath);
      if (await this.adapter.exists(tokenPath)) {
        manifestPath = tokenPath;
      }
    }

    if (!manifestPath) {
      const rootPath = getSliceManifestPath(manifestId, undefined, this.basePath);
      if (await this.adapter.exists(rootPath)) {
        manifestPath = rootPath;
      }
    }

    if (!manifestPath) {
      return null;
    }

    const content = await this.adapter.readFile(manifestPath);
    return JSON.parse(content) as SliceManifestV1;
  }

  /**
   * Store a run in the catalog
   *
   * @param runId - Run ID
   * @param runData - Run data
   * @returns Run manifest
   */
  async putRun(
    runId: string,
    runData: {
      strategyId?: string;
      strategyName?: string;
      seed?: string;
      note?: string;
      status: 'pending' | 'running' | 'completed' | 'failed';
      callsSimulated: number;
      callsSucceeded: number;
      callsFailed: number;
      summary: {
        avgPnl?: number;
        minPnl?: number;
        maxPnl?: number;
        totalTrades: number;
        winRate?: number;
      };
      artifacts?: {
        resultsParquet?: string;
        eventsNdjson?: string;
        sliceManifestId?: string;
        metricsJson?: string;
      };
      tags?: Record<string, string>;
    }
  ): Promise<RunManifest> {
    const createdAtIso = DateTime.now().toISO()!;
    const manifest = createRunManifest(runId, runData, createdAtIso);

    // Create run directory
    const runDir = getRunDirPath(runId, this.basePath);
    await this.adapter.mkdir(runDir);

    // Write run manifest
    const manifestPath = getRunManifestPath(runId, this.basePath);
    await this.adapter.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    // Update root catalog manifest
    await this.updateRootManifest((root) => {
      root.runs[runId] = {
        runId,
        createdAtIso,
        strategyId: runData.strategyId,
        status: runData.status,
        callsSimulated: runData.callsSimulated,
      };
      root.updatedAtIso = DateTime.now().toISO()!;
      return root;
    });

    return manifest;
  }

  /**
   * Retrieve a run manifest by ID
   *
   * @param runId - Run ID
   * @returns Run manifest or null if not found
   */
  async getRun(runId: string): Promise<RunManifest | null> {
    const manifestPath = getRunManifestPath(runId, this.basePath);

    if (!(await this.adapter.exists(manifestPath))) {
      return null;
    }

    const content = await this.adapter.readFile(manifestPath);
    const parsed = JSON.parse(content);
    return RunManifestSchema.parse(parsed);
  }

  /**
   * Find slices matching token and time range
   *
   * Searches catalog for existing slices that cover the requested time range for a token.
   * Returns slice manifests that can be reused.
   *
   * @param tokenId - Token mint address
   * @param timeRange - Time range to search for
   * @param dataset - Dataset name (e.g., 'candles_1m')
   * @param chain - Chain (e.g., 'sol')
   * @returns Array of matching slice manifests
   */
  async findSlices(
    tokenId: string,
    timeRange: { startIso: string; endIso: string },
    dataset: string,
    chain: string
  ): Promise<SliceManifestV1[]> {
    const root = await this.getRootManifest();
    const matches: SliceManifestV1[] = [];
    const requestStart = DateTime.fromISO(timeRange.startIso);
    const requestEnd = DateTime.fromISO(timeRange.endIso);

    // Search through all slices in the catalog
    for (const [manifestId, sliceMeta] of Object.entries(root.slices)) {
      // Check if slice matches criteria
      if (
        sliceMeta.tokenId === tokenId &&
        sliceMeta.dataset === dataset &&
        sliceMeta.chain === chain
      ) {
        // Check if slice time range covers or overlaps requested range
        const sliceStart = DateTime.fromISO(sliceMeta.timeRange.startIso);
        const sliceEnd = DateTime.fromISO(sliceMeta.timeRange.endIso);

        // Slice covers request if: sliceStart <= requestStart && sliceEnd >= requestEnd
        // Or if there's any overlap (for partial reuse)
        if (sliceStart <= requestEnd && sliceEnd >= requestStart) {
          const manifest = await this.getSlice(manifestId);
          if (manifest) {
            matches.push(manifest);
          }
        }
      }
    }

    // Sort by start time (earliest first)
    matches.sort((a, b) => {
      const aStart = DateTime.fromISO(a.spec.timeRange.startIso).toMillis();
      const bStart = DateTime.fromISO(b.spec.timeRange.startIso).toMillis();
      return aStart - bStart;
    });

    return matches;
  }

  /**
   * List runs with optional filtering
   *
   * @param options - Filter options
   * @returns Array of run manifests
   */
  async listRuns(options: ListRunsOptions = {}): Promise<RunManifest[]> {
    const runsDir = getCatalogPaths(this.basePath).runsDir;

    // Check if runs directory exists
    if (!(await this.adapter.exists(runsDir))) {
      return [];
    }

    // List all run directories
    const runDirs = await this.adapter.readdirDirs(runsDir);

    // Load all run manifests
    const runs: RunManifest[] = [];
    for (const runDirName of runDirs) {
      const runId = parseRunDirPath(join(runsDir, runDirName));
      if (!runId) {
        continue;
      }

      const run = await this.getRun(runId);
      if (!run) {
        continue;
      }

      // Apply filters
      if (options.strategyId && run.strategyId !== options.strategyId) {
        continue;
      }
      if (options.status && run.status !== options.status) {
        continue;
      }

      runs.push(run);
    }

    // Sort by creation time (newest first)
    runs.sort((a, b) => {
      const aTime = DateTime.fromISO(a.createdAtIso).toMillis();
      const bTime = DateTime.fromISO(b.createdAtIso).toMillis();
      return bTime - aTime;
    });

    // Apply pagination
    const offset = options.offset ?? 0;
    const limit = options.limit;
    const paginated = runs.slice(offset, limit ? offset + limit : undefined);

    return paginated;
  }

  /**
   * Get root catalog manifest
   *
   * @returns Root manifest (creates if doesn't exist)
   */
  private async getRootManifest(): Promise<CatalogRootManifest> {
    const rootPath = getCatalogPaths(this.basePath).rootManifestPath;

    if (await this.adapter.exists(rootPath)) {
      const content = await this.adapter.readFile(rootPath);
      const parsed = JSON.parse(content);
      return CatalogRootManifestSchema.parse(parsed);
    }

    // Create new root manifest
    const manifest = createCatalogRootManifest(DateTime.now().toISO()!);
    await this.adapter.writeFile(rootPath, JSON.stringify(manifest, null, 2));
    return manifest;
  }

  /**
   * Update root catalog manifest
   *
   * @param updater - Function to update manifest
   */
  private async updateRootManifest(
    updater: (manifest: CatalogRootManifest) => CatalogRootManifest
  ): Promise<void> {
    const root = await this.getRootManifest();
    const updated = updater(root);
    const rootPath = getCatalogPaths(this.basePath).rootManifestPath;
    await this.adapter.writeFile(rootPath, JSON.stringify(updated, null, 2));
  }
}

import { join } from 'path';
