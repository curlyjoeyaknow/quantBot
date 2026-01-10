/**
 * Research OS - Artifact Storage
 * ==============================
 *
 * Stores and retrieves run artifacts.
 * This is a simple file-based implementation that can be replaced
 * with a database or object store later.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { ValidationError, logger } from '@quantbot/utils';
import { getArtifactsDir } from '@quantbot/core';
import type { RunArtifact } from './artifacts.js';
import { RunArtifactSchema } from './artifacts.js';

/**
 * File-based artifact storage
 */
export class FileArtifactStorage {
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? getArtifactsDir();
  }

  /**
   * Get path for a run artifact
   */
  private getArtifactPath(runId: string): string {
    return join(this.baseDir, `${runId}.json`);
  }

  /**
   * Get path for the index file
   */
  private getIndexPath(): string {
    return join(this.baseDir, 'index.json');
  }

  /**
   * Ensure directory exists
   */
  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  /**
   * Load index
   */
  private async loadIndex(): Promise<string[]> {
    try {
      const indexPath = this.getIndexPath();
      const content = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(content) as string[];
      return Array.isArray(index) ? index : [];
    } catch {
      return [];
    }
  }

  /**
   * Save index
   */
  private async saveIndex(runIds: string[]): Promise<void> {
    const indexPath = this.getIndexPath();
    await fs.writeFile(indexPath, JSON.stringify(runIds, null, 2), 'utf-8');
  }

  /**
   * Save an artifact
   */
  async save(artifact: RunArtifact): Promise<void> {
    await this.ensureDir();

    // Defensive check: log artifact structure before validation
    logger.debug('Saving artifact', {
      runId: artifact.metadata?.runId,
      hasMetadata: !!artifact.metadata,
      metadataType: typeof artifact.metadata,
      metadataKeys: artifact.metadata ? Object.keys(artifact.metadata) : null,
      metadataGitSha: artifact.metadata?.gitSha,
      metadataCreatedAtISO: artifact.metadata?.createdAtISO,
      artifactKeys: Object.keys(artifact),
      artifactStringified: JSON.stringify(artifact, null, 2).substring(0, 500),
    });

    // Validate artifact
    const parsed = RunArtifactSchema.safeParse(artifact);
    if (!parsed.success) {
      // Log validation errors for debugging
      const firstIssue = parsed.error.issues[0];
      logger.error('Artifact validation failed', {
        runId: artifact.metadata?.runId,
        issueCount: parsed.error.issues.length,
        firstIssue: firstIssue
          ? {
              path: firstIssue.path,
              message: firstIssue.message,
              code: firstIssue.code,
            }
          : null,
        allIssues: parsed.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
          code: issue.code,
        })),
        artifactKeys: Object.keys(artifact),
        metadataKeys: artifact.metadata ? Object.keys(artifact.metadata) : null,
        metadataGitSha: artifact.metadata?.gitSha,
        metadataCreatedAtISO: artifact.metadata?.createdAtISO,
      });
      throw new ValidationError('Invalid artifact', {
        issues: parsed.error.issues,
        runId: artifact.metadata?.runId,
      });
    }

    // Save artifact file
    const artifactPath = this.getArtifactPath(artifact.metadata.runId);
    await fs.writeFile(artifactPath, JSON.stringify(artifact, null, 2), 'utf-8');

    // Update index
    const index = await this.loadIndex();
    if (!index.includes(artifact.metadata.runId)) {
      index.push(artifact.metadata.runId);
      await this.saveIndex(index);
    }
  }

  /**
   * Load an artifact by run ID
   */
  async load(runId: string): Promise<RunArtifact | null> {
    try {
      const artifactPath = this.getArtifactPath(runId);
      const content = await fs.readFile(artifactPath, 'utf-8');
      const artifact = JSON.parse(content) as unknown;

      // Validate artifact
      const parsed = RunArtifactSchema.safeParse(artifact);
      if (!parsed.success) {
        throw new ValidationError('Invalid artifact format', {
          issues: parsed.error.issues,
          runId,
        });
      }

      return parsed.data;
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * List all run IDs
   */
  async list(options?: { limit?: number; offset?: number }): Promise<string[]> {
    const index = await this.loadIndex();
    const offset = options?.offset ?? 0;
    const limit = options?.limit;

    if (limit === undefined) {
      return index.slice(offset);
    }

    return index.slice(offset, offset + limit);
  }

  /**
   * Delete an artifact
   */
  async delete(runId: string): Promise<void> {
    try {
      const artifactPath = this.getArtifactPath(runId);
      await fs.unlink(artifactPath);

      // Update index
      const index = await this.loadIndex();
      const filtered = index.filter((id) => id !== runId);
      await this.saveIndex(filtered);
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}
