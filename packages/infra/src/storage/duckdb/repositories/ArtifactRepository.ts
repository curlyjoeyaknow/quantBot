/**
 * ArtifactRepository - Repository for simulation run artifacts
 *
 * Manages artifact metadata and file paths for simulation runs.
 */

import { existsSync, statSync, mkdirSync } from 'fs';
import { join } from 'path';
import { logger } from '../../../utils/index.js';
import { getArtifactsDir } from '@quantbot/core';

export interface Artifact {
  type: 'parquet' | 'csv' | 'json' | 'ndjson' | 'log';
  path: string;
  size: number;
  createdAt?: string;
}

/**
 * ArtifactRepository
 */
export class ArtifactRepository {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? getArtifactsDir();
    // Ensure directory exists
    mkdirSync(this.baseDir, { recursive: true });
  }

  /**
   * Get artifacts for a run
   */
  async getByRunId(runId: string): Promise<Artifact[]> {
    const artifacts: Artifact[] = [];
    const runDir = join(this.baseDir, runId);

    if (!existsSync(runDir)) {
      return artifacts;
    }

    // Check for common artifact files
    const artifactFiles = [
      { name: 'manifest.json', type: 'json' as const },
      { name: 'events.ndjson', type: 'ndjson' as const },
      { name: 'events.parquet', type: 'parquet' as const },
      { name: 'events.csv', type: 'csv' as const },
      { name: 'metrics.json', type: 'json' as const },
      { name: 'positions.ndjson', type: 'ndjson' as const },
      { name: 'summary.csv', type: 'csv' as const },
      { name: 'debug.log', type: 'log' as const },
    ];

    for (const file of artifactFiles) {
      const filePath = join(runDir, file.name);
      if (existsSync(filePath)) {
        try {
          const stats = statSync(filePath);
          artifacts.push({
            type: file.type,
            path: `/artifacts/${runId}/${file.name}`,
            size: stats.size,
            createdAt: stats.birthtime.toISOString(),
          });
        } catch (error) {
          logger.warn('Failed to stat artifact file', { filePath, error });
        }
      }
    }

    return artifacts;
  }

  /**
   * Check if artifacts exist for a run
   */
  async hasArtifacts(runId: string): Promise<boolean> {
    const runDir = join(this.baseDir, runId);
    return existsSync(runDir);
  }
}
