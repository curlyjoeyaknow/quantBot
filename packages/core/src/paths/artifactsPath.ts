/**
 * Artifacts Path Utility
 *
 * Centralizes artifact directory path resolution.
 * Artifacts are stored outside the repository to avoid Vite watch issues.
 */

import path from 'node:path';
import os from 'node:os';

/**
 * Get the artifacts directory path.
 *
 * Uses QUANTBOT_ARTIFACTS_DIR environment variable if set,
 * otherwise defaults to ~/.cache/quantbot/artifacts
 *
 * @returns Absolute path to artifacts directory
 *
 * @example
 * ```typescript
 * const dir = getArtifactsDir();
 * // Returns: /home/user/.cache/quantbot/artifacts
 * ```
 */
export function getArtifactsDir(): string {
  return (
    process.env.QUANTBOT_ARTIFACTS_DIR ?? path.join(os.homedir(), '.cache', 'quantbot', 'artifacts')
  );
}
