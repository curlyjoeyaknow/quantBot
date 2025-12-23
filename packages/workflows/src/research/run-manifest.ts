/**
 * Research OS - Canonical RunManifest
 * ====================================
 *
 * Unified manifest that bridges CLI manifests and Research OS artifacts.
 * This is the single source of truth for run metadata.
 */

import { z } from 'zod';
import type { RunManifest as CLIRunManifest } from '@quantbot/core';
import type { RunMetadata, RunArtifact } from './artifacts.js';
import { createHash } from 'crypto';

/**
 * Canonical RunManifest Schema
 *
 * This extends the CLI RunManifest with Research OS fields.
 * It's backward compatible with CLI manifests but adds artifact-specific metadata.
 */
export const CanonicalRunManifestSchema = z.object({
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
   * Git branch name (optional)
   */
  git_branch: z.string().optional(),

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
   * Hash of run configuration (seed, time resolution, etc.)
   */
  run_config_hash: z.string().optional(),

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
   * Run status
   */
  status: z.enum(['pending', 'running', 'completed', 'failed']).default('pending'),

  /**
   * Error message (if status is 'failed')
   */
  error_message: z.string().optional(),

  /**
   * Simulation time (milliseconds)
   */
  simulation_time_ms: z.number().nonnegative().optional(),

  /**
   * Schema version (for evolution)
   */
  schema_version: z.string().default('1.0.0'),

  /**
   * Additional metadata (optional)
   */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type CanonicalRunManifest = z.infer<typeof CanonicalRunManifestSchema>;

/**
 * Convert CLI RunManifest to Canonical RunManifest
 */
export function fromCLIManifest(cliManifest: CLIRunManifest): CanonicalRunManifest {
  return CanonicalRunManifestSchema.parse({
    run_id: cliManifest.run_id,
    seed: cliManifest.seed,
    git_sha: cliManifest.git_sha,
    data_snapshot_hash: cliManifest.data_snapshot_hash,
    strategy_hash: cliManifest.strategy_hash,
    execution_model_hash: cliManifest.execution_model_hash,
    cost_model_hash: cliManifest.cost_model_hash,
    risk_model_hash: cliManifest.risk_model_hash,
    engine_version: cliManifest.engine_version,
    fingerprint: cliManifest.fingerprint,
    created_at: cliManifest.created_at,
    command: cliManifest.command,
    package_name: cliManifest.package_name,
    metadata: cliManifest.metadata,
    schema_version: '1.0.0',
  });
}

/**
 * Convert Research OS RunArtifact metadata to Canonical RunManifest
 */
export function fromRunArtifact(artifact: RunArtifact): CanonicalRunManifest {
  const metadata = artifact.metadata;

  return CanonicalRunManifestSchema.parse({
    run_id: metadata.runId,
    seed: artifact.request.runConfig.seed,
    git_sha: metadata.gitSha,
    git_branch: metadata.gitBranch,
    data_snapshot_hash: metadata.dataSnapshotHash,
    strategy_hash: metadata.strategyConfigHash,
    execution_model_hash: metadata.executionModelHash,
    cost_model_hash: metadata.costModelHash,
    risk_model_hash: metadata.riskModelHash,
    run_config_hash: metadata.runConfigHash,
    engine_version: metadata.schemaVersion,
    fingerprint: hashAllInputs({
      dataSnapshotHash: metadata.dataSnapshotHash,
      strategyConfigHash: metadata.strategyConfigHash,
      executionModelHash: metadata.executionModelHash,
      costModelHash: metadata.costModelHash,
      riskModelHash: metadata.riskModelHash,
      runConfigHash: metadata.runConfigHash,
    }),
    created_at: metadata.createdAtISO,
    status: 'completed',
    simulation_time_ms: metadata.simulationTimeMs,
    schema_version: metadata.schemaVersion,
  });
}

/**
 * Hash all inputs to create fingerprint
 */
function hashAllInputs(components: {
  dataSnapshotHash: string;
  strategyConfigHash: string;
  executionModelHash?: string;
  costModelHash?: string;
  riskModelHash?: string;
  runConfigHash: string;
}): string {
  const canonical = {
    data_snapshot_hash: components.dataSnapshotHash,
    strategy_config_hash: components.strategyConfigHash,
    execution_model_hash: components.executionModelHash ?? null,
    cost_model_hash: components.costModelHash ?? null,
    risk_model_hash: components.riskModelHash ?? null,
    run_config_hash: components.runConfigHash,
  };

  const json = JSON.stringify(canonical, Object.keys(canonical).sort());
  return createHash('sha256').update(json).digest('hex');
}

/**
 * Create canonical manifest from components
 */
export function createCanonicalManifest(components: {
  runId: string;
  seed: number;
  gitSha: string;
  gitBranch?: string;
  dataSnapshotHash: string;
  strategyHash: string;
  executionModelHash?: string;
  costModelHash?: string;
  riskModelHash?: string;
  runConfigHash?: string;
  engineVersion?: string;
  command?: string;
  packageName?: string;
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
}): CanonicalRunManifest {
  // Create fingerprint from all inputs
  const fingerprint = hashAllInputs({
    dataSnapshotHash: components.dataSnapshotHash,
    strategyConfigHash: components.strategyHash,
    executionModelHash: components.executionModelHash,
    costModelHash: components.costModelHash,
    riskModelHash: components.riskModelHash,
    runConfigHash: components.runConfigHash ?? '',
  });

  return CanonicalRunManifestSchema.parse({
    run_id: components.runId,
    seed: components.seed,
    git_sha: components.gitSha,
    git_branch: components.gitBranch,
    data_snapshot_hash: components.dataSnapshotHash,
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
    status: components.status ?? 'pending',
    error_message: components.errorMessage,
    simulation_time_ms: components.simulationTimeMs,
    schema_version: '1.0.0',
    metadata: components.metadata,
  });
}

