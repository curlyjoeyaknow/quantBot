/**
 * Git information utilities for audit trail.
 *
 * Captures current git state (commit hash, branch, dirty status) for run tracking.
 */

import { execSync } from 'child_process';

export interface GitInfo {
  commitHash: string;
  branch: string;
  dirty: boolean;
}

/**
 * Capture current git state for audit trail.
 * Returns defaults if not in a git repo or git unavailable.
 */
export async function getGitInfo(): Promise<GitInfo> {
  try {
    const commitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    const dirty = execSync('git status --porcelain', { encoding: 'utf-8' }).trim().length > 0;
    return { commitHash, branch, dirty };
  } catch {
    return { commitHash: 'unknown', branch: 'unknown', dirty: false };
  }
}

/**
 * Synchronous version of getGitInfo for contexts where async is not available.
 */
export function getGitInfoSync(): GitInfo {
  try {
    const commitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    const dirty = execSync('git status --porcelain', { encoding: 'utf-8' }).trim().length > 0;
    return { commitHash, branch, dirty };
  } catch {
    return { commitHash: 'unknown', branch: 'unknown', dirty: false };
  }
}

