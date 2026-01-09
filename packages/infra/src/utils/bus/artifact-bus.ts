/**
 * Artifact Bus - TypeScript helper for submitting artifacts to the Write-Once Artifact Bus
 *
 * This module provides a clean interface for TypeScript producers to submit
 * Parquet artifacts to the bus daemon without directly writing to DuckDB.
 *
 * Usage:
 *   import { submitArtifact } from '@quantbot/infra/utils/bus';
 *
 *   await submitArtifact({
 *     runId: 'run-123',
 *     producer: 'simulation',
 *     kind: 'trades',
 *     artifactId: 'trades',
 *     parquetPath: '/path/to/trades.parquet',
 *     schemaHint: 'canon.trades',
 *     rows: 1000,
 *     meta: { interval: '1m' }
 *   });
 */

import { join } from 'path';
import { PythonEngine } from '../python/python-engine.js';
import { logger } from '../logger.js';
import { findWorkspaceRoot } from '../fs/workspace-root.js';
import { z } from 'zod';

export interface SubmitArtifactOptions {
  /**
   * Unique run identifier
   */
  runId: string;
  /**
   * Producer name (e.g., 'simulation', 'baseline', 'optimizer', 'backtest', 'ingestion', 'manual')
   */
  producer: string;
  /**
   * Artifact kind (e.g., 'alerts_std', 'trades', 'metrics', 'fills', 'positions', 'events')
   */
  kind: string;
  /**
   * Unique artifact identifier within the run
   */
  artifactId: string;
  /**
   * Path to the Parquet file to submit
   */
  parquetPath: string;
  /**
   * Optional schema hint (e.g., 'canon.alerts_std')
   */
  schemaHint?: string;
  /**
   * Number of rows in the Parquet file (optional, will be computed if not provided)
   */
  rows?: number;
  /**
   * Optional metadata to attach to the artifact
   */
  meta?: Record<string, unknown>;
  /**
   * Bus root directory (default: 'data/bus')
   */
  busRoot?: string;
}

const SubmitArtifactResultSchema = z.object({
  success: z.boolean(),
  jobId: z.string().optional(),
  error: z.string().optional(),
});

export type SubmitArtifactResult = z.infer<typeof SubmitArtifactResultSchema>;

/**
 * Submit an artifact to the bus daemon
 *
 * This function:
 * 1. Creates a job directory in data/bus/inbox/
 * 2. Copies the Parquet file to the job directory
 * 3. Creates a manifest.json
 * 4. Marks the job as committed (creates COMMIT file)
 *
 * The daemon will then process the job and:
 * - Move files to canonical layout
 * - Update DuckDB catalog
 * - Regenerate golden exports
 */
export async function submitArtifact(
  options: SubmitArtifactOptions
): Promise<SubmitArtifactResult> {
  const {
    runId,
    producer,
    kind,
    artifactId,
    parquetPath,
    schemaHint = '',
    rows = 0,
    meta = {},
    busRoot = 'data/bus',
  } = options;

  try {
    // Generate job ID (timestamp-based for uniqueness)
    const jobId = `${new Date().toISOString().replace(/[:.]/g, '-')}__${producer}__${kind}`;

    // Get workspace root for script path
    const workspaceRoot = findWorkspaceRoot();
    const scriptPath = join(workspaceRoot, 'scripts', 'bus_submit.py');

    // Prepare arguments for bus_submit.py
    const args = {
      'bus-root': busRoot,
      'job-id': jobId,
      'run-id': runId,
      producer,
      kind,
      'artifact-id': artifactId,
      parquet: parquetPath,
      'schema-hint': schemaHint,
      rows: rows.toString(),
      'meta-json': JSON.stringify(meta),
    };

    logger.info('[artifact-bus] Submitting artifact', {
      runId,
      producer,
      kind,
      artifactId,
      jobId,
      parquetPath,
    });

    // Call bus_submit.py via PythonEngine
    // Note: bus_submit.py prints to stdout, not JSON, so we use expectJsonOutput: false
    const engine = new PythonEngine();
    await engine.runScript(
      scriptPath,
      args,
      z.any(), // No schema validation since output is not JSON
      {
        expectJsonOutput: false,
        timeout: 30000, // 30 seconds
      }
    );

    logger.info('[artifact-bus] Artifact submitted successfully', {
      runId,
      jobId,
    });

    return {
      success: true,
      jobId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[artifact-bus] Failed to submit artifact', {
      runId,
      producer,
      kind,
      artifactId,
      error: errorMessage,
    });

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Submit multiple artifacts in a single job
 *
 * This is useful when a producer generates multiple related artifacts
 * (e.g., fills, positions, events from a simulation run).
 *
 * Note: Currently each artifact is submitted as a separate job.
 * Future enhancement: support multi-artifact manifests.
 */
export async function submitArtifacts(
  options: Omit<SubmitArtifactOptions, 'artifactId' | 'parquetPath' | 'schemaHint' | 'rows'> & {
    artifacts: Array<{
      artifactId: string;
      parquetPath: string;
      schemaHint?: string;
      rows?: number;
    }>;
  }
): Promise<SubmitArtifactResult[]> {
  const results: SubmitArtifactResult[] = [];

  for (const artifact of options.artifacts) {
    const result = await submitArtifact({
      ...options,
      artifactId: artifact.artifactId,
      parquetPath: artifact.parquetPath,
      schemaHint: artifact.schemaHint,
      rows: artifact.rows,
    });
    results.push(result);
  }

  return results;
}
