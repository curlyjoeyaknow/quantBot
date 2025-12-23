/**
 * Research OS - RunManifest Utilities
 * ====================================
 *
 * DEPRECATED: This file is being consolidated to use the canonical RunManifest
 * from @quantbot/core. Use RunManifest, RunManifestSchema, and createRunManifest
 * from @quantbot/core instead.
 *
 * This file provides conversion utilities for backward compatibility only.
 * New code should use @quantbot/core directly.
 *
 * @deprecated Use @quantbot/core RunManifest directly
 */

import type { RunManifest } from '@quantbot/core';
import type { RunMetadata, RunArtifact } from './artifacts.js';

/**
 * @deprecated Use RunManifest from @quantbot/core instead
 * This type alias is kept for backward compatibility only.
 */
export type CanonicalRunManifest = RunManifest;

/**
 * Convert CLI RunManifest to Canonical RunManifest
 *
 * @deprecated CLI RunManifest is already the canonical RunManifest from @quantbot/core.
 * This function is kept for backward compatibility only. Just use the manifest directly.
 */
export function fromCLIManifest(cliManifest: RunManifest): CanonicalRunManifest {
  // CLI manifest is already canonical - just return it
  return cliManifest;
}

/**
 * Convert Research OS RunArtifact metadata to Canonical RunManifest
 *
 * @deprecated Use createRunManifest from @quantbot/core instead
 */
export async function fromRunArtifact(artifact: RunArtifact): Promise<CanonicalRunManifest> {
  const metadata = artifact.metadata;
  const { createRunManifest } = await import('@quantbot/core');

  return createRunManifest({
    runId: metadata.runId,
    seed: artifact.request.runConfig.seed,
    gitSha: metadata.gitSha,
    gitBranch: metadata.gitBranch,
    snapshotId: `legacy_${metadata.dataSnapshotHash.substring(0, 16)}`, // Legacy fallback - no snapshotId in old metadata
    snapshotContentHash: metadata.dataSnapshotHash,
    dataSnapshotHash: metadata.dataSnapshotHash, // backward compatibility
    strategyHash: metadata.strategyConfigHash,
    executionModelHash: metadata.executionModelHash,
    costModelHash: metadata.costModelHash,
    riskModelHash: metadata.riskModelHash,
    runConfigHash: metadata.runConfigHash,
    engineVersion: metadata.schemaVersion,
    status: 'completed',
    simulationTimeMs: metadata.simulationTimeMs,
    metadata: {
      createdAtISO: metadata.createdAtISO,
      schemaVersion: metadata.schemaVersion,
    },
  });
}

/**
 * Create canonical manifest from components
 *
 * @deprecated Use createRunManifest from @quantbot/core instead
 */
export async function createCanonicalManifest(components: {
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
}): Promise<CanonicalRunManifest> {
  const { createRunManifest } = await import('@quantbot/core');
  
  return createRunManifest({
    runId: components.runId,
    seed: components.seed,
    gitSha: components.gitSha,
    gitBranch: components.gitBranch,
    snapshotId: `legacy_${components.dataSnapshotHash.substring(0, 16)}`, // Legacy fallback
    snapshotContentHash: components.dataSnapshotHash,
    dataSnapshotHash: components.dataSnapshotHash, // backward compatibility
    strategyHash: components.strategyHash,
    executionModelHash: components.executionModelHash,
    costModelHash: components.costModelHash,
    riskModelHash: components.riskModelHash,
    runConfigHash: components.runConfigHash,
    engineVersion: components.engineVersion,
    command: components.command,
    packageName: components.packageName,
    artifactPaths: components.artifactPaths,
    status: components.status,
    errorMessage: components.errorMessage,
    simulationTimeMs: components.simulationTimeMs,
    metadata: components.metadata,
  });
}
