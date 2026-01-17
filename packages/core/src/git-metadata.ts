/**
 * Git metadata capture for experiment tracking
 *
 * Automatically captures git commit hash, branch, and status for reproducibility.
 */

import { execSync } from 'child_process';
import { z } from 'zod';

export const GitMetadataSchema = z.object({
  commitHash: z.string(),
  branch: z.string(),
  isDirty: z.boolean(),
  uncommittedChanges: z.array(z.string()).optional(),
  remoteUrl: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export type GitMetadata = z.infer<typeof GitMetadataSchema>;

/**
 * Capture git metadata from current repository
 */
export function captureGitMetadata(cwd?: string): GitMetadata {
  const options = cwd ? { cwd } : undefined;

  try {
    // Get commit hash
    const commitHash = execSync('git rev-parse HEAD', options).toString().trim();

    // Get branch name
    const branch = execSync('git rev-parse --abbrev-ref HEAD', options).toString().trim();

    // Check if working directory is dirty
    const status = execSync('git status --porcelain', options).toString().trim();
    const isDirty = status.length > 0;

    // Get uncommitted changes (if dirty)
    let uncommittedChanges: string[] | undefined;
    if (isDirty) {
      uncommittedChanges = status.split('\n').filter((line) => line.length > 0);
    }

    // Get remote URL (optional)
    let remoteUrl: string | undefined;
    try {
      remoteUrl = execSync('git config --get remote.origin.url', options).toString().trim();
    } catch {
      // No remote configured
    }

    // Get tags pointing to current commit (optional)
    let tags: string[] | undefined;
    try {
      const tagsOutput = execSync('git tag --points-at HEAD', options).toString().trim();
      if (tagsOutput) {
        tags = tagsOutput.split('\n');
      }
    } catch {
      // No tags
    }

    return {
      commitHash,
      branch,
      isDirty,
      uncommittedChanges,
      remoteUrl,
      tags,
    };
  } catch (error) {
    throw new Error(
      `Failed to capture git metadata: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get short commit hash (first 7 characters)
 */
export function getShortCommitHash(metadata: GitMetadata): string {
  return metadata.commitHash.substring(0, 7);
}

/**
 * Format git metadata as a string
 */
export function formatGitMetadata(metadata: GitMetadata): string {
  const short = getShortCommitHash(metadata);
  const dirty = metadata.isDirty ? ' (dirty)' : '';
  return `${metadata.branch}@${short}${dirty}`;
}

/**
 * Check if repository is in a clean state (no uncommitted changes)
 */
export function isCleanState(metadata: GitMetadata): boolean {
  return !metadata.isDirty;
}

/**
 * Validate that repository is in a clean state
 * Throws if there are uncommitted changes
 */
export function requireCleanState(metadata: GitMetadata): void {
  if (metadata.isDirty) {
    throw new Error(
      `Repository has uncommitted changes. Commit or stash changes before running experiments.\n${metadata.uncommittedChanges?.join('\n')}`
    );
  }
}

/**
 * Git metadata port (for dependency injection)
 */
export interface GitMetadataPort {
  capture(): GitMetadata;
  isClean(): boolean;
  requireClean(): void;
}

/**
 * Production git metadata adapter
 */
export class ProductionGitMetadata implements GitMetadataPort {
  constructor(private readonly cwd?: string) {}

  capture(): GitMetadata {
    return captureGitMetadata(this.cwd);
  }

  isClean(): boolean {
    const metadata = this.capture();
    return isCleanState(metadata);
  }

  requireClean(): void {
    const metadata = this.capture();
    requireCleanState(metadata);
  }
}

/**
 * Mock git metadata adapter (for testing)
 */
export class MockGitMetadata implements GitMetadataPort {
  constructor(private readonly metadata: GitMetadata) {}

  capture(): GitMetadata {
    return this.metadata;
  }

  isClean(): boolean {
    return isCleanState(this.metadata);
  }

  requireClean(): void {
    requireCleanState(this.metadata);
  }
}
