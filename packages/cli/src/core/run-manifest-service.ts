/**
 * Run Manifest Service
 *
 * Creates and manages run manifests for simulation runs.
 * Integrates with artifact manager to write manifest.json.
 */

import { getCurrentGitCommitHash } from '@quantbot/utils';
import {
  createRunManifest,
  hashObject,
  type RunInputComponents,
  type RunManifest,
} from '@quantbot/core';
import type { ArtifactPaths } from './artifact-manager.js';
import { writeArtifact } from './artifact-manager.js';

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
  /** Data snapshot (candles + calls metadata) */
  dataSnapshot: {
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

  // Hash data snapshot (calls + candles metadata)
  const dataSnapshotHash = hashObject(components.dataSnapshot);

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
    dataSnapshotHash,
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

