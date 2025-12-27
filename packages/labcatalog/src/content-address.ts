/**
 * Content Addressing - Hash-based IDs for deterministic cataloging
 *
 * Provides content-addressed IDs for slices and runs.
 * Same inputs → same IDs (deterministic).
 */

import { createHash } from 'crypto';
import type { SliceManifestV1 } from '@quantbot/core';

/**
 * Generate deterministic hash from input string
 *
 * @param input - Input string to hash
 * @returns SHA-256 hash (hex, truncated to 16 chars for readability)
 */
export function hashContent(input: string): string {
  return createHash('sha256').update(input, 'utf-8').digest('hex').substring(0, 16);
}

/**
 * Generate manifest ID from slice manifest
 *
 * Deterministic: same spec + content → same ID
 *
 * @param manifest - Slice manifest
 * @returns Manifest ID
 */
export function generateSliceManifestId(manifest: SliceManifestV1): string {
  // Use spec hash if available, otherwise compute from spec
  if (manifest.integrity?.specHash) {
    return hashContent(`manifest:${manifest.integrity.specHash}:${manifest.createdAtIso}`);
  }

  // Fallback: compute from spec + run context
  const specString = JSON.stringify({
    spec: manifest.spec,
    run: manifest.run,
    layout: manifest.layout,
  });
  return hashContent(`manifest:${specString}:${manifest.createdAtIso}`);
}

/**
 * Generate run ID from run context
 *
 * Deterministic: same context → same ID
 *
 * @param runContext - Run context (strategyId, seed, timestamp, etc.)
 * @returns Run ID
 */
export function generateRunId(runContext: {
  strategyId?: string;
  seed?: string;
  createdAtIso: string;
  note?: string;
}): string {
  const contextString = JSON.stringify({
    strategyId: runContext.strategyId,
    seed: runContext.seed,
    createdAtIso: runContext.createdAtIso,
    note: runContext.note,
  });
  return hashContent(`run:${contextString}`);
}

/**
 * Generate content hash for file content
 *
 * @param content - File content (string or Buffer)
 * @returns Content hash
 */
export function hashFileContent(content: string | Buffer): string {
  const buffer = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Generate hash for slice spec (for integrity checking)
 *
 * @param spec - Slice spec
 * @returns Spec hash
 */
export function hashSliceSpec(spec: {
  dataset: string;
  chain: string;
  timeRange: { startIso: string; endIso: string };
  tokenIds?: string[];
  columns?: string[];
  granularity?: string;
  tags?: Record<string, string>;
}): string {
  const specString = JSON.stringify(spec, Object.keys(spec).sort());
  return hashContent(`spec:${specString}`);
}
