/**
 * Run Manifest Service
 *
 * Creates and manages run manifests for simulation runs.
 * Integrates with artifact manager to write manifest.json.
 */

import { getCurrentGitCommitHash, ValidationError } from '@quantbot/infra/utils';
import { createRunManifest, hashObject, type RunManifest } from '@quantbot/core';
import type { ArtifactPaths } from './artifact-manager.js';
import { writeArtifact } from './artifact-manager.js';
import type { DataSnapshotRef } from '@quantbot/data-observatory';

/**
 * Components needed to create a run manifest
 */
export interface RunManifestComponents {
  /** Run ID */
  runId: string;
  /** Random seed */
  seed: number;
  /** Strategy configuration (full config object) */
  strategyConfig: unknown;
  /**
   * Data snapshot reference (REQUIRED for new runs)
   *
   * This is the snapshot reference from the data observatory snapshot system.
   * Contains snapshot ID, content hash, spec, and manifest.
   *
   * For backward compatibility, you can still provide dataSnapshot (deprecated),
   * but snapshotRef is required for new runs.
   */
  snapshotRef?: DataSnapshotRef;
  /**
   * Data snapshot (candles + calls metadata) - DEPRECATED
   *
   * @deprecated Use snapshotRef instead. Kept for backward compatibility.
   * If snapshotRef is provided, dataSnapshot is ignored.
   */
  dataSnapshot?: {
    calls: Array<{ mint: string; alertTimestamp: string }>;
    candles?: Array<{ mint: string; fromISO: string; toISO: string }>;
  };
  /** Execution model configuration (optional) */
  executionModel?: unknown;
  /** Cost model configuration (optional) */
  costModel?: unknown;
  /** Risk model configuration (optional) */
  riskModel?: unknown;
  /** Engine version (optional, defaults to '1.0.0') */
  engineVersion?: string;
  /** Command name (optional) */
  command?: string;
  /** Package name (optional) */
  packageName?: string;
  /** Additional metadata (optional) */
  metadata?: Record<string, unknown>;
}

/**
 * Create and write run manifest
 *
 * @param paths - Artifact paths
 * @param components - Manifest components
 * @returns Created manifest
 */
export async function createAndWriteRunManifest(
  paths: ArtifactPaths,
  components: RunManifestComponents
): Promise<RunManifest> {
  // Get git SHA
  const gitSha = getCurrentGitCommitHash();

  // Hash strategy config
  const strategyHash = hashObject(components.strategyConfig);

  // CRITICAL: Use snapshotRef if provided (required for new runs), otherwise fall back to dataSnapshot (backward compatibility)
  let snapshotId: string;
  let snapshotContentHash: string;
  let dataSnapshotHash: string | undefined;

  if (components.snapshotRef) {
    // Use snapshot reference (new way - required for new runs)
    snapshotId = components.snapshotRef.snapshotId;
    snapshotContentHash = components.snapshotRef.contentHash;
    // For backward compatibility, also compute dataSnapshotHash from snapshotRef
    // This ensures fingerprint computation is consistent
    dataSnapshotHash = snapshotContentHash;
  } else if (components.dataSnapshot) {
    // Backward compatibility: compute hash from dataSnapshot metadata
    dataSnapshotHash = hashObject(components.dataSnapshot);
    // For backward compatibility, we need snapshotId and snapshotContentHash
    // Since we don't have a snapshotRef, we'll use a synthetic ID based on the hash
    // This is not ideal but allows old manifests to continue working
    snapshotId = `legacy_${dataSnapshotHash.substring(0, 16)}`;
    snapshotContentHash = dataSnapshotHash;
    console.warn(
      `WARNING: Run manifest created without snapshotRef. Using legacy dataSnapshot. ` +
        `Please migrate to using snapshotRef for reproducible runs. Run ID: ${components.runId}`
    );
  } else {
    throw new ValidationError(
      'Either snapshotRef or dataSnapshot must be provided to create run manifest. For new runs, snapshotRef is required.',
      { runId: components.runId }
    );
  }

  // Hash execution model (if provided)
  const executionModelHash = components.executionModel
    ? hashObject(components.executionModel)
    : undefined;

  // Hash cost model (if provided)
  const costModelHash = components.costModel ? hashObject(components.costModel) : undefined;

  // Hash risk model (if provided)
  const riskModelHash = components.riskModel ? hashObject(components.riskModel) : undefined;

  // Create manifest
  const manifest = createRunManifest({
    runId: components.runId,
    seed: components.seed,
    gitSha,
    snapshotId,
    snapshotContentHash,
    dataSnapshotHash, // backward compatibility
    strategyHash,
    executionModelHash,
    costModelHash,
    riskModelHash,
    engineVersion: components.engineVersion,
    command: components.command,
    packageName: components.packageName,
    metadata: components.metadata,
  });

  // Write manifest to disk
  await writeArtifact(paths, 'manifestJson', manifest);

  return manifest;
}

/**
 * Read run manifest from disk
 *
 * @param paths - Artifact paths
 * @returns Parsed manifest or null if not found
 */
export async function readRunManifest(paths: ArtifactPaths): Promise<RunManifest | null> {
  try {
    const { readFile } = await import('fs/promises');
    const { RunManifestSchema } = await import('@quantbot/core');
    const content = await readFile(paths.manifestJson, 'utf8');
    const manifest = JSON.parse(content);
    return RunManifestSchema.parse(manifest);
  } catch {
    return null;
  }
}
