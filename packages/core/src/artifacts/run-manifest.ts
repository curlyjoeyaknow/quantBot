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
   * Hash of input data snapshot (candles, calls, etc.)
   * Format: SHA256 hash of canonical data representation
   */
  data_snapshot_hash: z.string(),

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
   * Additional metadata (optional)
   */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type RunManifest = z.infer<typeof RunManifestSchema>;

/**
 * Input components for hashing
 */
export interface RunInputComponents {
  /** Data snapshot hash */
  dataSnapshotHash: string;
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
  // Create canonical representation (sorted keys for determinism)
  const canonical = {
    data_snapshot_hash: components.dataSnapshotHash,
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
  dataSnapshotHash: string;
  strategyHash: string;
  executionModelHash?: string;
  costModelHash?: string;
  riskModelHash?: string;
  engineVersion?: string;
  command?: string;
  packageName?: string;
  metadata?: Record<string, unknown>;
}): RunManifest {
  const fingerprint = hashInputs({
    dataSnapshotHash: components.dataSnapshotHash,
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
    data_snapshot_hash: components.dataSnapshotHash,
    strategy_hash: components.strategyHash,
    execution_model_hash: components.executionModelHash,
    cost_model_hash: components.costModelHash,
    risk_model_hash: components.riskModelHash,
    engine_version: components.engineVersion ?? '1.0.0',
    fingerprint,
    created_at: new Date().toISOString(),
    command: components.command,
    package_name: components.packageName,
    metadata: components.metadata,
  };

  return RunManifestSchema.parse(manifest);
}

