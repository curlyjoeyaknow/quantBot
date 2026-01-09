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
  // Runs catalog table
  await db.execute(`
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
    )
  `);
  
  // Artifacts catalog table (one row per artifact file)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS backtest_artifacts_catalog (
      run_id TEXT NOT NULL,
      artifact_type TEXT NOT NULL,
      artifact_path TEXT NOT NULL,
      rows INTEGER NOT NULL,
      created_at TIMESTAMP,
      
      -- Catalog metadata
      cataloged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      
      PRIMARY KEY (run_id, artifact_type)
    )
  `);
  
  logger.info('Initialized catalog tables');
}

// =============================================================================
// Catalog Registration
// =============================================================================

/**
 * Register a completed run into the catalog
 */
export async function registerRun(
  db: DuckDBClient,
  runDir: string
): Promise<void> {
  // Check if run is complete
  const isComplete = await RunDirectory.isComplete(runDir);
  if (!isComplete) {
    logger.debug('Skipping incomplete run', { runDir });
    return;
  }
  
  // Read manifest
  const manifest = await RunDirectory.readManifest(runDir);
  
  // Check if already cataloged
  const existing = await db.execute(
    `SELECT run_id FROM backtest_runs_catalog WHERE run_id = '${manifest.run_id}'`
  );
  if (existing && existing.length > 0) {
    logger.debug('Run already cataloged', { runId: manifest.run_id });
    return;
  }
  
  // Insert into runs catalog
  const manifestPath = join(runDir, 'run.json');
  await db.execute(`
    INSERT INTO backtest_runs_catalog (
      run_id, run_type, status,
      created_at, started_at, completed_at,
      git_commit, git_branch, git_dirty,
      dataset_from, dataset_to, dataset_interval, dataset_calls_count,
      parameters_json,
      timing_plan_ms, timing_coverage_ms, timing_slice_ms,
      timing_execution_ms, timing_optimization_ms, timing_total_ms,
      artifacts_json,
      run_dir, manifest_path
    ) VALUES (
      '${manifest.run_id}',
      '${manifest.run_type}',
      '${manifest.status}',
      '${manifest.created_at}',
      ${manifest.started_at ? `'${manifest.started_at}'` : 'NULL'},
      ${manifest.completed_at ? `'${manifest.completed_at}'` : 'NULL'},
      ${manifest.git_commit ? `'${manifest.git_commit}'` : 'NULL'},
      ${manifest.git_branch ? `'${manifest.git_branch}'` : 'NULL'},
      ${manifest.git_dirty !== undefined ? (manifest.git_dirty ? 'TRUE' : 'FALSE') : 'NULL'},
      ${manifest.dataset.from ? `'${manifest.dataset.from}'` : 'NULL'},
      ${manifest.dataset.to ? `'${manifest.dataset.to}'` : 'NULL'},
      '${manifest.dataset.interval}',
      ${manifest.dataset.calls_count},
      '${JSON.stringify(manifest.parameters).replace(/'/g, "''")}',
      ${manifest.timing?.plan_ms ?? 'NULL'},
      ${manifest.timing?.coverage_ms ?? 'NULL'},
      ${manifest.timing?.slice_ms ?? 'NULL'},
      ${manifest.timing?.execution_ms ?? 'NULL'},
      ${manifest.timing?.optimization_ms ?? 'NULL'},
      ${manifest.timing?.total_ms ?? 'NULL'},
      '${JSON.stringify(manifest.artifacts).replace(/'/g, "''")}',
      '${runDir.replace(/'/g, "''")}',
      '${manifestPath.replace(/'/g, "''")}'
    )
  `);
  
  // Insert artifacts into artifacts catalog
  for (const [artifactType, artifactInfo] of Object.entries(manifest.artifacts)) {
    if (!artifactInfo) continue;
    
    const artifactPath = join(runDir, artifactInfo.path);
    await db.execute(`
      INSERT INTO backtest_artifacts_catalog (
        run_id, artifact_type, artifact_path, rows, created_at
      ) VALUES (
        '${manifest.run_id}',
        '${artifactType}',
        '${artifactPath.replace(/'/g, "''")}',
        ${artifactInfo.rows},
        '${manifest.created_at}'
      )
    `);
  }
  
  logger.info('Registered run in catalog', {
    runId: manifest.run_id,
    runType: manifest.run_type,
    artifactsCount: Object.keys(manifest.artifacts).length,
  });
}

/**
 * Scan and register all completed runs
 */
export async function catalogAllRuns(
  db: DuckDBClient,
  baseDir: string = 'runs'
): Promise<{ registered: number; skipped: number }> {
  const runDirs = await listRunDirectories(baseDir, true);
  
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
  
  logger.info('Catalog scan complete', { registered, skipped, total: runDirs.length });
  
  return { registered, skipped };
}

// =============================================================================
// Query Helpers
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
  let sql = 'SELECT * FROM backtest_runs_catalog WHERE 1=1';
  
  if (criteria.runType) {
    sql += ` AND run_type = '${criteria.runType}'`;
  }
  if (criteria.status) {
    sql += ` AND status = '${criteria.status}'`;
  }
  if (criteria.gitBranch) {
    sql += ` AND git_branch = '${criteria.gitBranch}'`;
  }
  if (criteria.fromDate) {
    sql += ` AND created_at >= '${criteria.fromDate}'`;
  }
  if (criteria.toDate) {
    sql += ` AND created_at <= '${criteria.toDate}'`;
  }
  
  sql += ' ORDER BY created_at DESC';
  
  if (criteria.limit) {
    sql += ` LIMIT ${criteria.limit}`;
  }
  
  const rows = await db.execute(sql);
  
  // Convert rows to RunManifest objects
  return rows.map((row: any) => ({
    run_id: row.run_id,
    run_type: row.run_type,
    status: row.status,
    created_at: row.created_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
    git_commit: row.git_commit,
    git_branch: row.git_branch,
    git_dirty: row.git_dirty,
    dataset: {
      from: row.dataset_from,
      to: row.dataset_to,
      interval: row.dataset_interval,
      calls_count: row.dataset_calls_count,
    },
    parameters: JSON.parse(row.parameters_json),
    schema_version: {
      manifest: '1.0.0',
      artifacts: '1.0.0',
    },
    artifacts: JSON.parse(row.artifacts_json),
    timing: {
      plan_ms: row.timing_plan_ms,
      coverage_ms: row.timing_coverage_ms,
      slice_ms: row.timing_slice_ms,
      execution_ms: row.timing_execution_ms,
      optimization_ms: row.timing_optimization_ms,
      total_ms: row.timing_total_ms,
    },
  }));
}

/**
 * Get artifact path for a specific run and artifact type
 */
export async function getArtifactPath(
  db: DuckDBClient,
  runId: string,
  artifactType: ArtifactType
): Promise<string | null> {
  const rows = await db.execute(`
    SELECT artifact_path
    FROM backtest_artifacts_catalog
    WHERE run_id = '${runId}' AND artifact_type = '${artifactType}'
  `);
  
  if (rows && rows.length > 0) {
    return rows[0].artifact_path;
  }
  
  return null;
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
  const [totalRuns] = await db.execute('SELECT COUNT(*) as count FROM backtest_runs_catalog');
  const [completedRuns] = await db.execute(
    "SELECT COUNT(*) as count FROM backtest_runs_catalog WHERE status = 'completed'"
  );
  const [failedRuns] = await db.execute(
    "SELECT COUNT(*) as count FROM backtest_runs_catalog WHERE status = 'failed'"
  );
  
  const runsByTypeRows = await db.execute(`
    SELECT run_type, COUNT(*) as count
    FROM backtest_runs_catalog
    GROUP BY run_type
  `);
  const runsByType: Record<string, number> = {};
  for (const row of runsByTypeRows) {
    runsByType[row.run_type] = row.count;
  }
  
  const [totalArtifacts] = await db.execute('SELECT COUNT(*) as count FROM backtest_artifacts_catalog');
  
  const artifactsByTypeRows = await db.execute(`
    SELECT artifact_type, COUNT(*) as count
    FROM backtest_artifacts_catalog
    GROUP BY artifact_type
  `);
  const artifactsByType: Record<string, number> = {};
  for (const row of artifactsByTypeRows) {
    artifactsByType[row.artifact_type] = row.count;
  }
  
  return {
    totalRuns: totalRuns.count,
    completedRuns: completedRuns.count,
    failedRuns: failedRuns.count,
    runsByType,
    totalArtifacts: totalArtifacts.count,
    artifactsByType,
  };
}

