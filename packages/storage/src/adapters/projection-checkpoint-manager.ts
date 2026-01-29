/**
 * Projection Checkpoint Manager
 *
 * Manages checkpoints for partial failure recovery during projection builds.
 * Allows resuming builds from the last successful checkpoint.
 */

import { logger } from '@quantbot/infra/utils';
import { existsSync } from 'fs';
import { readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { z } from 'zod';

/**
 * Checkpoint state for resuming builds
 */
export interface BuildCheckpoint {
  checkpointId: string;
  projectionId: string;
  version: string;
  duckdbPath: string;
  cacheDir: string;
  request: {
    projectionId: string;
    artifacts: {
      alerts?: string[];
      ohlcv?: string[];
    };
    tables: {
      alerts?: string;
      ohlcv?: string;
    };
    indexes?: Array<{ table: string; columns: string[] }>;
  };
  completedArtifacts: {
    alerts: string[];
    ohlcv: string[];
  };
  completedTables: string[];
  createdAt: number;
  lastUpdated: number;
}

const CheckpointSchema = z.object({
  checkpointId: z.string(),
  projectionId: z.string(),
  version: z.string(),
  duckdbPath: z.string(),
  cacheDir: z.string(),
  request: z.object({
    projectionId: z.string(),
    artifacts: z.object({
      alerts: z.array(z.string()).optional(),
      ohlcv: z.array(z.string()).optional(),
    }),
    tables: z.object({
      alerts: z.string().optional(),
      ohlcv: z.string().optional(),
    }),
    indexes: z
      .array(
        z.object({
          table: z.string(),
          columns: z.array(z.string()),
        })
      )
      .optional(),
  }),
  completedArtifacts: z.object({
    alerts: z.array(z.string()),
    ohlcv: z.array(z.string()),
  }),
  completedTables: z.array(z.string()),
  createdAt: z.number(),
  lastUpdated: z.number(),
});

/**
 * Checkpoint manager for projection builds
 */
export class ProjectionCheckpointManager {
  private readonly checkpointDir: string;

  constructor(checkpointDir: string) {
    this.checkpointDir = checkpointDir;
  }

  /**
   * Create a checkpoint
   */
  async createCheckpoint(checkpoint: BuildCheckpoint): Promise<void> {
    // Ensure checkpoint directory exists
    if (!existsSync(this.checkpointDir)) {
      await mkdir(this.checkpointDir, { recursive: true });
    }

    const checkpointPath = join(this.checkpointDir, `${checkpoint.checkpointId}.json`);
    await writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2), 'utf-8');

    logger.debug('Checkpoint created', {
      checkpointId: checkpoint.checkpointId,
      projectionId: checkpoint.projectionId,
    });
  }

  /**
   * Update an existing checkpoint
   */
  async updateCheckpoint(checkpointId: string, updates: Partial<BuildCheckpoint>): Promise<void> {
    const checkpoint = await this.getCheckpoint(checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    const updated: BuildCheckpoint = {
      ...checkpoint,
      ...updates,
      lastUpdated: Date.now(),
    };

    await this.createCheckpoint(updated);
  }

  /**
   * Get a checkpoint
   */
  async getCheckpoint(checkpointId: string): Promise<BuildCheckpoint | null> {
    const checkpointPath = join(this.checkpointDir, `${checkpointId}.json`);

    if (!existsSync(checkpointPath)) {
      return null;
    }

    try {
      const content = await readFile(checkpointPath, 'utf-8');
      const parsed = JSON.parse(content);
      return CheckpointSchema.parse(parsed);
    } catch (error) {
      logger.warn('Failed to read checkpoint', {
        checkpointId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Delete a checkpoint
   */
  async deleteCheckpoint(checkpointId: string): Promise<void> {
    const checkpointPath = join(this.checkpointDir, `${checkpointId}.json`);

    if (existsSync(checkpointPath)) {
      try {
        await unlink(checkpointPath);
        logger.debug('Checkpoint deleted', { checkpointId });
      } catch (error) {
        logger.warn('Failed to delete checkpoint', {
          checkpointId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * List all checkpoints for a projection
   */
  async listCheckpoints(projectionId: string): Promise<BuildCheckpoint[]> {
    // This would require scanning the directory
    // For now, return empty array - can be enhanced if needed
    return [];
  }

  /**
   * Cleanup old checkpoints (older than maxAgeMs)
   */
  async cleanupOldCheckpoints(maxAgeMs: number): Promise<number> {
    // This would require scanning the directory
    // For now, return 0 - can be enhanced if needed
    return 0;
  }
}
