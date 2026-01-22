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

import type { RunManifest } from '@quantbot/labcatalog';
import { createRunManifest } from '@quantbot/labcatalog';
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
 * @deprecated Use createRunManifest from @quantbot/labcatalog instead - signature has changed
 */
export async function fromRunArtifact(_artifact: RunArtifact): Promise<CanonicalRunManifest> {
  throw new Error(
    'fromRunArtifact is deprecated - use createRunManifest from @quantbot/labcatalog with correct signature'
  );
  // const metadata = artifact.metadata;
  // return createRunManifest(metadata.runId, { ... }, './catalog');
}

/**
 * Create canonical manifest from components
 *
 * @deprecated Use createRunManifest from @quantbot/labcatalog instead - signature has changed
 */
export async function createCanonicalManifest(_components: {
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
  throw new Error(
    'createCanonicalManifest is deprecated - use createRunManifest from @quantbot/labcatalog with correct signature'
  );
  // return createRunManifest(components.runId, { ... }, './catalog');
}
