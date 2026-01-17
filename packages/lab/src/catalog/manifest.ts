/**
 * Catalog Manifest Schema
 *
 * Extends SliceManifestV1 with catalog-specific metadata.
 * Provides Zod schemas for validation.
 */

import { z } from 'zod';
import type { SliceManifestV1 } from '@quantbot/core';

/**
 * Run manifest schema
 *
 * Stores metadata about a simulation run in the catalog.
 */
export const RunManifestSchema = z.object({
  version: z.literal(1),
  runId: z.string().min(1),
  createdAtIso: z.string(),
  updatedAtIso: z.string().optional(),

  // Run context
  strategyId: z.string().optional(),
  strategyName: z.string().optional(),
  seed: z.string().optional(),
  note: z.string().optional(),

  // Run metadata
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  callsSimulated: z.number().int().min(0),
  callsSucceeded: z.number().int().min(0),
  callsFailed: z.number().int().min(0),

  // Summary statistics
  summary: z.object({
    avgPnl: z.number().optional(),
    minPnl: z.number().optional(),
    maxPnl: z.number().optional(),
    totalTrades: z.number().int().min(0),
    winRate: z.number().optional(),
  }),

  // Artifact references
  artifacts: z
    .object({
      resultsParquet: z.string().optional(),
      eventsNdjson: z.string().optional(),
      sliceManifestId: z.string().optional(), // Reference to slice used
      metricsJson: z.string().optional(),
    })
    .optional(),

  // Optional tags for filtering
  tags: z.record(z.string()).optional(),
});

export type RunManifest = z.infer<typeof RunManifestSchema>;

/**
 * Root catalog manifest schema
 *
 * Tracks all slices and runs in the catalog.
 */
export const CatalogRootManifestSchema = z.object({
  version: z.literal(1),
  createdAtIso: z.string(),
  updatedAtIso: z.string(),

  // Index of slices (manifest ID → metadata)
  slices: z.record(
    z.string(),
    z.object({
      manifestId: z.string(),
      tokenId: z.string().optional(),
      createdAtIso: z.string(),
      dataset: z.string(),
      chain: z.string(),
      timeRange: z.object({
        startIso: z.string(),
        endIso: z.string(),
      }),
      fileCount: z.number().int().min(0),
      totalRows: z.number().optional(),
      totalBytes: z.number().optional(),
    })
  ),

  // Index of runs (run ID → metadata)
  runs: z.record(
    z.string(),
    z.object({
      runId: z.string(),
      createdAtIso: z.string(),
      strategyId: z.string().optional(),
      status: z.enum(['pending', 'running', 'completed', 'failed']),
      callsSimulated: z.number().int().min(0),
    })
  ),
});

export type CatalogRootManifest = z.infer<typeof CatalogRootManifestSchema>;

/**
 * Create a new catalog root manifest
 *
 * @returns Empty catalog manifest
 */
export function createCatalogRootManifest(createdAtIso: string): CatalogRootManifest {
  return {
    version: 1,
    createdAtIso,
    updatedAtIso: createdAtIso,
    slices: {},
    runs: {},
  };
}

/**
 * Create a run manifest from run data
 *
 * @param runId - Run ID
 * @param runData - Run data
 * @param createdAtIso - Creation timestamp
 * @returns Run manifest
 */
export function createRunManifest(
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
  },
  createdAtIso: string
): RunManifest {
  return {
    version: 1,
    runId,
    createdAtIso,
    strategyId: runData.strategyId,
    strategyName: runData.strategyName,
    seed: runData.seed,
    note: runData.note,
    status: runData.status,
    callsSimulated: runData.callsSimulated,
    callsSucceeded: runData.callsSucceeded,
    callsFailed: runData.callsFailed,
    summary: runData.summary,
    artifacts: runData.artifacts,
    tags: runData.tags,
  };
}
