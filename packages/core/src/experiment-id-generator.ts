/**
 * Experiment ID Generator
 *
 * Generates unique, deterministic experiment IDs.
 */

import { seedFromString } from './determinism.js';

/**
 * Generate experiment ID from inputs
 *
 * Format: `exp-{timestamp}-{hash}`
 * Same inputs → same ID (deterministic)
 */
export function generateExperimentId(
  timestamp: string,
  strategyId: string,
  dataSnapshotHash: string,
  parameterVectorHash?: string
): string {
  const hashInput = parameterVectorHash
    ? `${strategyId}-${dataSnapshotHash}-${parameterVectorHash}`
    : `${strategyId}-${dataSnapshotHash}`;

  const hash = seedFromString(hashInput).toString(16).slice(0, 8);
  const timestampShort = timestamp.replace(/[^0-9]/g, '').slice(0, 14); // YYYYMMDDHHmmss

  return `exp-${timestampShort}-${hash}`;
}

/**
 * Generate experiment ID from run metadata
 */
export function generateExperimentIdFromMetadata(metadata: {
  timestamp: string;
  strategyId: string;
  dataSnapshotHash: string;
  parameterVectorHash?: string;
}): string {
  return generateExperimentId(
    metadata.timestamp,
    metadata.strategyId,
    metadata.dataSnapshotHash,
    metadata.parameterVectorHash
  );
}
