/**
 * Replay from Manifest Handler
 *
 * First-class command to re-run a simulation from a manifest file.
 * This is a key requirement for Phase 2: making RunManifest the spine.
 *
 * CRITICAL: This command uses the snapshot_id from the manifest to load
 * the DataSnapshotRef, ensuring reproducibility.
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import type { z } from 'zod';
import { researchReplayManifestSchema } from '../../command-defs/research.js';
import type { CommandContext } from '../../core/command-context.js';
import { replaySimulation, createExperimentContext } from '@quantbot/workflows';
import { logger, ValidationError, ConfigurationError } from '@quantbot/infra/utils';
import { RunManifestSchema } from '@quantbot/core';
import { createSnapshotManager } from '@quantbot/data-observatory';

export type ReplayManifestArgs = z.infer<typeof researchReplayManifestSchema>;

/**
 * Replay a simulation from a manifest file
 *
 * This is the "first-class re-run" command that makes manifests the spine.
 * It:
 * 1. Loads the manifest file (using RunManifestSchema from @quantbot/core)
 * 2. Extracts snapshot_id from manifest (REQUIRED for reproducible runs)
 * 3. Loads DataSnapshotRef from snapshot storage
 * 4. Verifies snapshot content hash matches manifest
 * 5. Replays the simulation using the snapshot data
 *
 * This ensures that re-runs use the exact same data snapshot as the original run.
 */
export async function replayManifestHandler(args: ReplayManifestArgs, ctx: CommandContext) {
  await ctx.ensureInitialized();

  logger.info(`[research.replay-manifest] Loading manifest from ${args.manifestFile}`);

  // Read and parse manifest
  const manifestContent = await readFile(args.manifestFile, 'utf-8');
  let manifest;
  try {
    manifest = JSON.parse(manifestContent);
  } catch (error) {
    throw new ValidationError('Invalid manifest file: not valid JSON', {
      path: args.manifestFile,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Validate manifest structure using RunManifestSchema from @quantbot/core
  const validatedManifest = RunManifestSchema.safeParse(manifest);
  if (!validatedManifest.success) {
    throw new ValidationError('Invalid manifest structure', {
      path: args.manifestFile,
      issues: validatedManifest.error.issues,
    });
  }

  const manifestData = validatedManifest.data;
  const runId = manifestData.run_id;

  logger.info(`[research.replay-manifest] Replaying simulation ${runId} from manifest`);

  // CRITICAL: Load snapshot ref from snapshot_id in manifest
  // This ensures we use the exact same data snapshot as the original run
  if (!manifestData.snapshot_id) {
    throw new ValidationError(
      'Manifest does not contain snapshot_id. Cannot replay without snapshot reference. ' +
        'This manifest was created before snapshot refs were added. ' +
        'Please re-run the original simulation to create a new manifest with snapshot refs.',
      {
        path: args.manifestFile,
        runId,
      }
    );
  }

  // Determine snapshot storage path (default to data/snapshots.duckdb)
  // In the future, this could be configurable via environment variable
  const manifestDir = dirname(args.manifestFile);
  const snapshotDbPath =
    process.env.SNAPSHOT_DB_PATH || join(manifestDir, '../data/snapshots.duckdb');

  logger.info(
    `[research.replay-manifest] Loading snapshot ${manifestData.snapshot_id} from ${snapshotDbPath}`
  );

  try {
    const snapshotManager = createSnapshotManager(snapshotDbPath);
    const snapshotRef = await snapshotManager.getSnapshot(manifestData.snapshot_id);

    if (!snapshotRef) {
      throw new ValidationError(
        `Snapshot ${manifestData.snapshot_id} not found in snapshot storage. ` +
          `Cannot replay without the original snapshot.`,
        {
          snapshotId: manifestData.snapshot_id,
          snapshotDbPath,
          runId,
        }
      );
    }

    // Verify snapshot content hash matches manifest (integrity check)
    if (snapshotRef.contentHash !== manifestData.snapshot_content_hash) {
      throw new ValidationError(
        `Snapshot content hash mismatch. ` +
          `Manifest expects ${manifestData.snapshot_content_hash}, ` +
          `but snapshot has ${snapshotRef.contentHash}. ` +
          `The snapshot may have been modified or corrupted.`,
        {
          snapshotId: manifestData.snapshot_id,
          expectedHash: manifestData.snapshot_content_hash,
          actualHash: snapshotRef.contentHash,
          runId,
        }
      );
    }

    logger.info(
      `[research.replay-manifest] Verified snapshot ${manifestData.snapshot_id} ` +
        `(content hash: ${manifestData.snapshot_content_hash.substring(0, 8)}...)`
    );
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ConfigurationError(
      `Failed to load snapshot ${manifestData.snapshot_id} from ${snapshotDbPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  // Create experiment context
  const experimentCtx = createExperimentContext({
    artifactBaseDir: process.cwd(),
  });

  // Replay simulation using existing infrastructure
  // NOTE: The replaySimulation function will use the snapshot_id from the manifest
  // to load the snapshot data when it re-runs the simulation
  const artifact = await replaySimulation(runId, experimentCtx);

  logger.info(`[research.replay-manifest] Completed replay ${artifact.metadata.runId}`);

  // Verify that the replayed run ID matches the manifest run ID
  if (artifact.metadata.runId !== runId) {
    logger.warn(
      `[research.replay-manifest] Replayed run ID (${artifact.metadata.runId}) does not match manifest run ID (${runId})`
    );
  }

  return {
    runId: artifact.metadata.runId,
    manifestRunId: runId,
    snapshotId: manifestData.snapshot_id,
    artifact,
    manifest: manifestData,
  };
}
