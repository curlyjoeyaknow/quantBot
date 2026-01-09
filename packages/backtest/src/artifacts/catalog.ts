/**
 * Catalog Registration (Stub)
 *
 * NOTE: The catalog functionality needs to be reimplemented to work with the
 * DuckDBClient API which is Python-based. For now, this is a stub that allows
 * the code to compile.
 *
 * TODO: Implement catalog using native duckdb-node or a different approach.
 */

import { logger } from '@quantbot/utils';
import type { RunManifest, ArtifactType } from './types.js';

// Stub type for compatibility
export type DuckDBClient = any;

/**
 * Initialize catalog tables in DuckDB (STUB)
 */
export async function initializeCatalog(db: DuckDBClient): Promise<void> {
  logger.warn('Catalog initialization is not yet implemented');
  // TODO: Implement with native duckdb-node
}

/**
 * Register a completed run into the catalog (STUB)
 */
export async function registerRun(db: DuckDBClient, runDir: string): Promise<void> {
  logger.warn('Run registration is not yet implemented', { runDir });
  // TODO: Implement with native duckdb-node
}

/**
 * Scan and register all completed runs (STUB)
 */
export async function catalogAllRuns(
  db: DuckDBClient,
  baseDir: string = 'runs'
): Promise<{ registered: number; skipped: number }> {
  logger.warn('Catalog scan is not yet implemented', { baseDir });
  return { registered: 0, skipped: 0 };
  // TODO: Implement with native duckdb-node
}

/**
 * Query runs by criteria (STUB)
 */
export async function queryRuns(
  db: DuckDBClient,
  criteria: {
    runType?: string;
    status?: string;
    gitBranch?: string;
    fromDate?: string;
    toDate?: string;
    limit?: number;
  } = {}
): Promise<RunManifest[]> {
  logger.warn('Query runs is not yet implemented', { criteria });
  return [];
  // TODO: Implement with native duckdb-node
}

/**
 * Get artifact path for a specific run and artifact type (STUB)
 */
export async function getArtifactPath(
  db: DuckDBClient,
  runId: string,
  artifactType: ArtifactType
): Promise<string | null> {
  logger.warn('Get artifact path is not yet implemented', { runId, artifactType });
  return null;
  // TODO: Implement with native duckdb-node
}

/**
 * Get summary statistics across all runs (STUB)
 */
export async function getCatalogStats(db: DuckDBClient): Promise<{
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  runsByType: Record<string, number>;
  totalArtifacts: number;
  artifactsByType: Record<string, number>;
}> {
  logger.warn('Get catalog stats is not yet implemented');
  return {
    totalRuns: 0,
    completedRuns: 0,
    failedRuns: 0,
    runsByType: {},
    totalArtifacts: 0,
    artifactsByType: {},
  };
  // TODO: Implement with native duckdb-node
}

