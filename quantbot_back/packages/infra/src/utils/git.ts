/**
 * Git Utilities
 *
 * Detect current git commit hash and repository state.
 */

import { execSync } from 'child_process';

/**
 * Get current git commit hash
 *
 * @returns Commit hash or 'unknown' if not in git repo or git not available
 */
export function getCurrentGitCommitHash(): string {
  try {
    const hash = execSync('git rev-parse HEAD', { encoding: 'utf-8', stdio: 'pipe' }).trim();
    return hash;
  } catch {
    return 'unknown';
  }
}

/**
 * Get current git commit hash (short form)
 */
export function getCurrentGitCommitHashShort(): string {
  try {
    const hash = execSync('git rev-parse --short HEAD', {
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();
    return hash;
  } catch {
    return 'unknown';
  }
}

/**
 * Check if repository has uncommitted changes
 */
export function hasUncommittedChanges(): boolean {
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf-8', stdio: 'pipe' }).trim();
    return status.length > 0;
  } catch {
    return false;
  }
}

/**
 * Get git repository info
 */
export function getGitRepositoryInfo(): {
  commitHash: string;
  commitHashShort: string;
  hasUncommittedChanges: boolean;
} {
  return {
    commitHash: getCurrentGitCommitHash(),
    commitHashShort: getCurrentGitCommitHashShort(),
    hasUncommittedChanges: hasUncommittedChanges(),
  };
}
