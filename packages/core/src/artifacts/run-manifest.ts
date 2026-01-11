/**
 * Run Manifest - Canonical Run Artifact Contract
 *
 * Defines the manifest schema for simulation runs, enabling:
 * - Portability: Any run can be re-run from manifest alone
 * - Comparability: Two runs can be compared by fingerprints
 * - Reproducibility: All inputs are hashed and versioned
 */

import { z } from 'zod';
import { createHash } from 'crypto';

/**
 * Run Manifest Schema
 *
 * Contains all information needed to reproduce a simulation run.
 */
export const RunManifestSchema = z.object({
  /**
   * Run identifier (deterministic from inputs)
   */
  run_id: z.string(),

  /**
   * Random seed used for deterministic execution
   */
  seed: z.number().int(),

  /**
   * Git commit SHA at time of run (for code versioning)
   */
  git_sha: z.string(),

  /**
   * Data snapshot reference (REQUIRED for reproducible runs)
   * 
   * This is the snapshot ID from the data observatory snapshot system.
   * The snapshot ID can be used to load the full DataSnapshotRef which contains:
   * - Snapshot spec (sources, time range, filters)
   * - Snapshot manifest (event counts, coverage, quality metrics)
   * - Content hash for integrity verification
   * 
   * This replaces data_snapshot_hash for new runs (snapshotId + contentHash provide better traceability).
   */
  snapshot_id: z.string(),

  /**
   * Data snapshot content hash (SHA-256)
   * 
   * This is the contentHash from DataSnapshotRef. Used to verify snapshot integrity
   * and ensure the snapshot hasn't changed since the run was created.
   * 
   * MUST match the contentHash of the DataSnapshotRef loaded by snapshot_id.
   */
  snapshot_content_hash: z.string(),

  /**
   * Hash of input data snapshot (candles, calls, etc.) - DEPRECATED
   * 
   * @deprecated Use snapshot_id and snapshot_content_hash instead.
   * Kept for backward compatibility with older manifests.
   * For new runs, this should match snapshot_content_hash.
   */
  data_snapshot_hash: z.string().optional(),

  /**
   * Hash of strategy configuration
   * Format: SHA256 hash of canonical strategy JSON
   */
  strategy_hash: z.string(),

  /**
   * Hash of execution model configuration
   * Format: SHA256 hash of canonical execution model JSON
   */
  execution_model_hash: z.string().optional(),

  /**
   * Hash of cost model configuration
   * Format: SHA256 hash of canonical cost config JSON
   */
  cost_model_hash: z.string().optional(),

  /**
   * Hash of risk model configuration
   * Format: SHA256 hash of canonical risk model JSON
   */
  risk_model_hash: z.string().optional(),

  /**
   * Engine version (simulation engine contract version)
   */
  engine_version: z.string().default('1.0.0'),

  /**
   * Run fingerprint (hash of all inputs)
   * This is the single hash that uniquely identifies a run configuration
   */
  fingerprint: z.string(),

  /**
   * Timestamp when run was created (ISO 8601)
   */
  created_at: z.string(),

  /**
   * Command that generated this run
   */
  command: z.string().optional(),

  /**
   * Package name
   */
  package_name: z.string().optional(),

  /**
   * Git branch name (optional, for development tracking)
   */
  git_branch: z.string().optional(),

  /**
   * Run configuration hash (optional, for run-level config like time resolution)
   */
  run_config_hash: z.string().optional(),

  /**
   * Artifact paths (where artifacts are stored)
   */
  artifact_paths: z
    .object({
      manifest_json: z.string().optional(),
      events_ndjson: z.string().optional(),
      metrics_json: z.string().optional(),
      positions_ndjson: z.string().optional(),
      debug_log: z.string().optional(),
    })
    .optional(),

  /**
   * Run status (for tracking run lifecycle)
   */
  status: z.enum(['pending', 'running', 'completed', 'failed']).optional(),

  /**
   * Error message (if status is 'failed')
   */
  error_message: z.string().optional(),

  /**
   * Simulation time in milliseconds (performance tracking)
   */
  simulation_time_ms: z.number().nonnegative().optional(),

  /**
   * Schema version (for evolution and migration)
   */
  schema_version: z.string().default('1.0.0'),

  /**
   * Additional metadata (optional)
   */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type RunManifest = z.infer<typeof RunManifestSchema>;

/**
 * Input components for hashing
 */
export interface RunInputComponents {
  /** Data snapshot content hash (from DataSnapshotRef) */
  snapshotContentHash: string;
  /** Strategy hash */
  strategyHash: string;
  /** Execution model hash (optional) */
  executionModelHash?: string;
  /** Cost model hash (optional) */
  costModelHash?: string;
  /** Risk model hash (optional) */
  riskModelHash?: string;
  /** Seed */
  seed: number;
  /** Engine version */
  engineVersion?: string;
  /**
   * @deprecated Use snapshotContentHash instead
   */
  dataSnapshotHash?: string;
}

/**
 * Hash inputs to produce run fingerprint
 *
 * This function produces a deterministic hash from all run inputs.
 * Same inputs → same fingerprint (enables run comparison).
 *
 * @param components - Input components to hash
 * @returns SHA256 hash (hex string, 64 chars)
 */
export function hashInputs(components: RunInputComponents): string {
  // Use snapshotContentHash if provided, otherwise fall back to dataSnapshotHash (backward compatibility)
  const snapshotHash = components.snapshotContentHash ?? components.dataSnapshotHash;
  if (!snapshotHash) {
    throw new Error('snapshotContentHash is required for run fingerprint generation');
  }

  // Create canonical representation (sorted keys for determinism)
  const canonical = {
    snapshot_content_hash: snapshotHash,
    strategy_hash: components.strategyHash,
    execution_model_hash: components.executionModelHash ?? null,
    cost_model_hash: components.costModelHash ?? null,
    risk_model_hash: components.riskModelHash ?? null,
    seed: components.seed,
    engine_version: components.engineVersion ?? '1.0.0',
  };

  // Serialize to JSON (sorted keys, no whitespace)
  const json = JSON.stringify(canonical, Object.keys(canonical).sort());

  // Hash with SHA256
  return createHash('sha256').update(json).digest('hex');
}

/**
 * Hash a JSON-serializable object
 *
 * Produces deterministic hash from object (sorted keys, no whitespace).
 *
 * @param obj - Object to hash
 * @returns SHA256 hash (hex string, 64 chars)
 */
export function hashObject(obj: unknown): string {
  // Serialize to JSON (sorted keys, no whitespace)
  const json = JSON.stringify(obj, (key, value) => {
    // Sort object keys for determinism
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(value).sort()) {
        sorted[k] = value[k];
      }
      return sorted;
    }
    return value;
  });

  // Hash with SHA256
  return createHash('sha256').update(json).digest('hex');
}

/**
 * Create run manifest from components
 *
 * @param components - Manifest components
 * @returns Validated run manifest
 */
export function createRunManifest(components: {
  runId: string;
  seed: number;
  gitSha: string;
  /** Snapshot ID from data observatory (REQUIRED for new runs) */
  snapshotId: string;
  /** Snapshot content hash from DataSnapshotRef (REQUIRED for new runs) */
  snapshotContentHash: string;
  strategyHash: string;
  executionModelHash?: string;
  costModelHash?: string;
  riskModelHash?: string;
  engineVersion?: string;
  command?: string;
  packageName?: string;
  gitBranch?: string;
  runConfigHash?: string;
  artifactPaths?: {
    manifestJson?: string;
    eventsNdjson?: string;
    metricsJson?: string;
    positionsNdjson?: string;
    debugLog?: string;
  };
  status?: 'pending' | 'running' | 'completed' | 'failed';
  errorMessage?: string;
  simulationTimeMs?: number;
  metadata?: Record<string, unknown>;
  /**
   * @deprecated Use snapshotContentHash instead
   */
  dataSnapshotHash?: string;
}): RunManifest {
  const fingerprint = hashInputs({
    snapshotContentHash: components.snapshotContentHash,
    dataSnapshotHash: components.dataSnapshotHash, // backward compatibility
    strategyHash: components.strategyHash,
    executionModelHash: components.executionModelHash,
    costModelHash: components.costModelHash,
    riskModelHash: components.riskModelHash,
    seed: components.seed,
    engineVersion: components.engineVersion,
  });

  const manifest: RunManifest = {
    run_id: components.runId,
    seed: components.seed,
    git_sha: components.gitSha,
    git_branch: components.gitBranch,
    snapshot_id: components.snapshotId,
    snapshot_content_hash: components.snapshotContentHash,
    data_snapshot_hash: components.dataSnapshotHash, // backward compatibility
    strategy_hash: components.strategyHash,
    execution_model_hash: components.executionModelHash,
    cost_model_hash: components.costModelHash,
    risk_model_hash: components.riskModelHash,
    run_config_hash: components.runConfigHash,
    engine_version: components.engineVersion ?? '1.0.0',
    fingerprint,
    created_at: new Date().toISOString(),
    command: components.command,
    package_name: components.packageName,
    artifact_paths: components.artifactPaths
      ? {
          manifest_json: components.artifactPaths.manifestJson,
          events_ndjson: components.artifactPaths.eventsNdjson,
          metrics_json: components.artifactPaths.metricsJson,
          positions_ndjson: components.artifactPaths.positionsNdjson,
          debug_log: components.artifactPaths.debugLog,
        }
      : undefined,
    status: components.status,
    error_message: components.errorMessage,
    simulation_time_ms: components.simulationTimeMs,
    schema_version: '1.0.0',
    metadata: components.metadata,
  };

  return RunManifestSchema.parse(manifest);
}
