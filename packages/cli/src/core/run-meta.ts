/**
 * Run Metadata Utilities
 *
 * Utilities for generating run metadata:
 * - Git SHA (for reproducibility)
 * - Config hash (for deduplication)
 * - Run ID generation (deterministic)
 *
 * These utilities ensure every run is traceable and reproducible.
 */

import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { DateTime } from 'luxon';

/**
 * Get git SHA (or "unknown" if not in git repo)
 *
 * Used for reproducibility - every run includes the git commit it was run from.
 */
export function getGitSha(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Generate config hash for reproducibility
 *
 * Creates a deterministic hash from config parameters.
 * Same config parameters = same hash (useful for deduplication).
 *
 * @param config - Config object to hash
 * @returns First 16 characters of SHA256 hash
 */
export function generateConfigHash(config: Record<string, unknown>): string {
  // Sort keys for deterministic ordering
  const sortedKeys = Object.keys(config).sort();
  const sortedConfig: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    sortedConfig[key] = config[key];
  }

  const json = JSON.stringify(sortedConfig);
  return createHash('sha256').update(json).digest('hex').substring(0, 16);
}

/**
 * Generate sweep ID from timestamp
 *
 * Format: sweep-YYYYMMDD-HHmmss
 *
 * @returns Sweep ID string
 */
export function generateSweepId(): string {
  return `sweep-${DateTime.utc().toFormat('yyyyMMdd-HHmmss')}`;
}

/**
 * Run metadata structure
 */
export interface RunMetadata {
  sweepId: string;
  startedAtISO: string;
  completedAtISO: string;
  durationMs: number;
  gitSha: string;
  configHash: string;
  config: Record<string, unknown>;
  counts: {
    totalRuns: number;
    totalResults: number;
    totalCallerSummaries?: number;
  };
  diagnostics?: Record<string, unknown>;
  completedScenarioIds?: string[]; // For resume support
}
