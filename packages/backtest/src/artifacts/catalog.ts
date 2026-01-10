/**
 * Catalog Registration
 *
 * Daemon utilities for registering completed runs into DuckDB catalog.
 * This provides a queryable index over all runs without blocking run execution.
 */

import { join } from 'path';
import { promises as fs } from 'fs';
import { DuckDBClient } from '@quantbot/storage';
import { logger } from '@quantbot/utils';
import type { RunManifest, ArtifactType } from './types.js';
import { RunDirectory, listRunDirectories } from './writer.js';

// =============================================================================
// Catalog Schema
// =============================================================================

/**
 * Initialize catalog tables in DuckDB
 */
export async function initializeCatalog(db: DuckDBClient): Promise<void> {
  const sql = `
    CREATE TABLE IF NOT EXISTS backtest_runs_catalog (
      run_id TEXT PRIMARY KEY,
      run_type TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL,
      started_at TIMESTAMP,
      completed_at TIMESTAMP,
      
      -- Provenance
      git_commit TEXT,
      git_branch TEXT,
      git_dirty BOOLEAN,
      
      -- Dataset
      dataset_from TIMESTAMP,
      dataset_to TIMESTAMP,
      dataset_interval TEXT,
      dataset_calls_count INTEGER,
      
      -- Parameters (JSON)
      parameters_json TEXT,
      
      -- Timing (ms)
      timing_plan_ms DOUBLE,
      timing_coverage_ms DOUBLE,
      timing_slice_ms DOUBLE,
      timing_execution_ms DOUBLE,
      timing_optimization_ms DOUBLE,
      timing_total_ms DOUBLE,
      
      -- Artifacts inventory (JSON)
      artifacts_json TEXT,
      
      -- Paths
      run_dir TEXT NOT NULL,
      manifest_path TEXT NOT NULL,
      
      -- Catalog metadata
      cataloged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS backtest_artifacts_catalog (
      run_id TEXT NOT NULL,
      artifact_type TEXT NOT NULL,
      artifact_path TEXT NOT NULL,
      rows INTEGER NOT NULL,
      created_at TIMESTAMP,
      
      -- Catalog metadata
      cataloged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      
      PRIMARY KEY (run_id, artifact_type)
    );
  `;
  
  await db.execute(sql);
  logger.info('Initialized catalog tables');
}

// =============================================================================
// Catalog Registration
// =============================================================================

/**
 * Register a completed run into the catalog
 */
export async function registerRun(db: DuckDBClient, runDir: string): Promise<void> {
  // Read manifest first to check status
  let manifest: RunManifest;
  try {
    manifest = await RunDirectory.readManifest(runDir);
  } catch (error) {
    logger.debug('Skipping run - manifest not found', { runDir });
    return;
  }
  
  // Check if run is complete (completed or failed - not pending or running)
  if (manifest.status !== 'completed' && manifest.status !== 'failed') {
    logger.debug('Skipping incomplete run', { runDir, status: manifest.status });
    return;
  }
  
  // Check if already registered
  const existing = await db.query(
    `SELECT run_id FROM backtest_runs_catalog WHERE run_id = '${manifest.run_id}'`
  );
  if (existing.rows.length > 0) {
    logger.debug('Run already registered', { runId: manifest.run_id });
    return;
  }
  
  // Prepare run catalog entry
  const manifestPath = join(runDir, 'run.json');
  const parametersJson = manifest.parameters ? JSON.stringify(manifest.parameters) : null;
  const artifactsJson = JSON.stringify(manifest.artifacts);
  
  // Escape SQL strings
  const escapeSql = (str: string): string => str.replace(/'/g, "''");
  
  // Insert run (execute first)
  const runInsertSql = `
    INSERT INTO backtest_runs_catalog (
      run_id, run_type, status, created_at, started_at, completed_at,
      git_commit, git_branch, git_dirty,
      dataset_from, dataset_to, dataset_interval, dataset_calls_count,
      parameters_json,
      timing_plan_ms, timing_coverage_ms, timing_slice_ms, timing_execution_ms, timing_optimization_ms, timing_total_ms,
      artifacts_json,
      run_dir, manifest_path
    ) VALUES (
      '${escapeSql(manifest.run_id)}',
      '${escapeSql(manifest.run_type)}',
      '${escapeSql(manifest.status)}',
      '${escapeSql(manifest.created_at)}',
      ${manifest.started_at ? `'${escapeSql(manifest.started_at)}'` : 'NULL'},
      ${manifest.completed_at ? `'${escapeSql(manifest.completed_at)}'` : 'NULL'},
      ${manifest.git_commit ? `'${escapeSql(manifest.git_commit)}'` : 'NULL'},
      ${manifest.git_branch ? `'${escapeSql(manifest.git_branch)}'` : 'NULL'},
      ${manifest.git_dirty !== undefined ? (manifest.git_dirty ? 'TRUE' : 'FALSE') : 'NULL'},
      ${manifest.dataset?.from ? `'${escapeSql(manifest.dataset.from)}'` : 'NULL'},
      ${manifest.dataset?.to ? `'${escapeSql(manifest.dataset.to)}'` : 'NULL'},
      ${manifest.dataset?.interval ? `'${escapeSql(manifest.dataset.interval)}'` : 'NULL'},
      ${manifest.dataset?.calls_count ?? 'NULL'},
      ${parametersJson ? `'${escapeSql(parametersJson)}'` : 'NULL'},
      ${manifest.timing?.plan_ms ?? 'NULL'},
      ${manifest.timing?.coverage_ms ?? 'NULL'},
      ${manifest.timing?.slice_ms ?? 'NULL'},
      ${manifest.timing?.execution_ms ?? 'NULL'},
      ${manifest.timing?.optimization_ms ?? 'NULL'},
      ${manifest.timing?.total_ms ?? 'NULL'},
      '${escapeSql(artifactsJson)}',
      '${escapeSql(runDir)}',
      '${escapeSql(manifestPath)}'
    )
  `;
  
  await db.execute(runInsertSql);
  
  // Insert artifacts (execute separately)
  for (const [artifactType, artifactInfo] of Object.entries(manifest.artifacts)) {
    const artifactPath = join(runDir, artifactInfo.path);
    const artifactInsertSql = `
      INSERT INTO backtest_artifacts_catalog (
        run_id, artifact_type, artifact_path, rows
      ) VALUES (
        '${escapeSql(manifest.run_id)}',
        '${escapeSql(artifactType)}',
        '${escapeSql(artifactPath)}',
        ${artifactInfo.rows}
      )
    `;
    await db.execute(artifactInsertSql);
  }
  
  logger.info('Registered run to catalog', {
    runId: manifest.run_id,
    artifacts: Object.keys(manifest.artifacts).length,
  });
}

/**
 * Scan and register all completed runs
 */
export async function catalogAllRuns(
  db: DuckDBClient,
  baseDir: string = 'runs'
): Promise<{ registered: number; skipped: number }> {
  // List all runs (not just those with _SUCCESS) - we'll filter by manifest status
  const runDirs = await listRunDirectories(baseDir, false); // All runs
  
  let registered = 0;
  let skipped = 0;
  
  for (const runDir of runDirs) {
    try {
      await registerRun(db, runDir);
      registered++;
    } catch (error) {
      logger.warn('Failed to register run', {
        runDir,
        error: error instanceof Error ? error.message : String(error),
      });
      skipped++;
    }
  }
  
  logger.info('Catalog scan complete', { registered, skipped });
  return { registered, skipped };
}

// =============================================================================
// Catalog Queries
// =============================================================================

/**
 * Query runs by criteria
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
  const conditions: string[] = [];
  
  if (criteria.runType) {
    conditions.push(`run_type = '${criteria.runType}'`);
  }
  if (criteria.status) {
    conditions.push(`status = '${criteria.status}'`);
  }
  if (criteria.gitBranch) {
    conditions.push(`git_branch = '${criteria.gitBranch}'`);
  }
  if (criteria.fromDate) {
    conditions.push(`created_at >= '${criteria.fromDate}'`);
  }
  if (criteria.toDate) {
    conditions.push(`created_at <= '${criteria.toDate}'`);
  }
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitClause = criteria.limit ? `LIMIT ${criteria.limit}` : '';
  
  // Cast datetime columns to strings to avoid JSON serialization issues
  const sql = `
    SELECT 
      run_id, run_type, status,
      CAST(created_at AS TEXT) as created_at,
      CAST(started_at AS TEXT) as started_at,
      CAST(completed_at AS TEXT) as completed_at,
      git_commit, git_branch, git_dirty,
      CAST(dataset_from AS TEXT) as dataset_from,
      CAST(dataset_to AS TEXT) as dataset_to,
      dataset_interval, dataset_calls_count,
      parameters_json,
      timing_plan_ms, timing_coverage_ms, timing_slice_ms, timing_execution_ms, timing_optimization_ms, timing_total_ms,
      artifacts_json,
      run_dir, manifest_path,
      CAST(cataloged_at AS TEXT) as cataloged_at
    FROM backtest_runs_catalog
    ${whereClause}
    ORDER BY created_at DESC
    ${limitClause}
  `;
  
  const result = await db.query(sql);
  
  // Convert rows to RunManifest objects
  const manifests: RunManifest[] = [];
  const manifestPathIdx = result.columns.findIndex((c) => c.name === 'manifest_path');
  
  for (const row of result.rows) {
    const manifestPath = row[manifestPathIdx] as string;
    try {
      // manifest_path is the full path to run.json, we need the directory
      const runDir = manifestPath.replace(/\/run\.json$/, '');
      const manifest = await RunDirectory.readManifest(runDir);
      manifests.push(manifest);
    } catch (error) {
      logger.warn('Failed to read manifest', { manifestPath, error });
    }
  }
  
  return manifests;
}

/**
 * Get artifact path for a specific run and artifact type
 */
export async function getArtifactPath(
  db: DuckDBClient,
  runId: string,
  artifactType: ArtifactType
): Promise<string | null> {
  const sql = `
    SELECT artifact_path FROM backtest_artifacts_catalog
    WHERE run_id = '${runId}' AND artifact_type = '${artifactType}'
  `;
  
  const result = await db.query(sql);
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return result.rows[0][0] as string;
}

/**
 * Get summary statistics across all runs
 */
export async function getCatalogStats(db: DuckDBClient): Promise<{
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  runsByType: Record<string, number>;
  totalArtifacts: number;
  artifactsByType: Record<string, number>;
}> {
  // Total runs
  const totalRunsResult = await db.query('SELECT COUNT(*) as count FROM backtest_runs_catalog');
  const totalRuns = totalRunsResult.rows.length > 0 ? (totalRunsResult.rows[0][0] as number) : 0;
  
  // Completed runs
  const completedRunsResult = await db.query(
    "SELECT COUNT(*) as count FROM backtest_runs_catalog WHERE status = 'completed'"
  );
  const completedRuns = completedRunsResult.rows.length > 0 ? (completedRunsResult.rows[0][0] as number) : 0;
  
  // Failed runs
  const failedRunsResult = await db.query(
    "SELECT COUNT(*) as count FROM backtest_runs_catalog WHERE status = 'failed'"
  );
  const failedRuns = failedRunsResult.rows.length > 0 ? (failedRunsResult.rows[0][0] as number) : 0;
  
  // Runs by type
  const runsByTypeResult = await db.query(
    'SELECT run_type, COUNT(*) as count FROM backtest_runs_catalog GROUP BY run_type'
  );
  const runsByType: Record<string, number> = {};
  for (const row of runsByTypeResult.rows) {
    runsByType[row[0] as string] = row[1] as number;
  }
  
  // Total artifacts
  const totalArtifactsResult = await db.query(
    'SELECT COUNT(*) as count FROM backtest_artifacts_catalog'
  );
  const totalArtifacts = totalArtifactsResult.rows.length > 0 ? (totalArtifactsResult.rows[0][0] as number) : 0;
  
  // Artifacts by type
  const artifactsByTypeResult = await db.query(
    'SELECT artifact_type, COUNT(*) as count FROM backtest_artifacts_catalog GROUP BY artifact_type'
  );
  const artifactsByType: Record<string, number> = {};
  for (const row of artifactsByTypeResult.rows) {
    artifactsByType[row[0] as string] = row[1] as number;
  }
  
  return {
    totalRuns,
    completedRuns,
    failedRuns,
    runsByType,
    totalArtifacts,
    artifactsByType,
  };
}
