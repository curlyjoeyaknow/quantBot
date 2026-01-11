/**
 * Run Research Simulation Handler
 *
 * CRITICAL: This handler includes snapshotRef in the result's _manifest property
 * so that execute() can create a proper RunManifest with snapshot references.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import type { z } from 'zod';
import { researchRunSchema } from '../../command-defs/research.js';
import type { CommandContext } from '../../core/command-context.js';
import { runSingleSimulation, createExperimentContext } from '@quantbot/workflows';
import type { SimulationRequest } from '@quantbot/workflows';
import { logger } from '@quantbot/utils';
import { createSnapshotManager } from '@quantbot/data-observatory';
import type { DataSnapshotRef } from '@quantbot/data-observatory';

export type RunSimulationArgs = z.infer<typeof researchRunSchema>;

/**
 * Run a single simulation from a request JSON file
 *
 * This handler:
 * 1. Runs the simulation using the workflow
 * 2. Extracts snapshotId from the artifact's request
 * 3. Loads the full DataSnapshotRef from snapshot storage
 * 4. Includes snapshotRef in the result's _manifest for RunManifest creation
 */
export async function runSimulationHandler(args: RunSimulationArgs, ctx: CommandContext) {
  await ctx.ensureInitialized();

  // Read request file
  const requestContent = await readFile(args.requestFile, 'utf-8');
  const request: SimulationRequest = JSON.parse(requestContent);

  logger.info(`[research.run] Starting simulation from ${args.requestFile}`);

  // Create experiment context
  const experimentCtx = createExperimentContext({
    artifactBaseDir: process.cwd(),
  });

  // Run simulation
  const artifact = await runSingleSimulation(request, experimentCtx);

  logger.info(`[research.run] Completed simulation ${artifact.metadata.runId}`);

  // CRITICAL: Load snapshotRef from snapshot storage to include in manifest
  // The workflow's request contains snapshotId, but we need the full DataSnapshotRef
  let snapshotRef: DataSnapshotRef | undefined;
  if (request.dataSnapshot?.snapshotId) {
    try {
      // Determine snapshot storage path (default to data/snapshots.duckdb)
      const snapshotDbPath =
        process.env.SNAPSHOT_DB_PATH || join(process.cwd(), 'data/snapshots.duckdb');
      const snapshotManager = createSnapshotManager(snapshotDbPath);
      const loadedRef = await snapshotManager.getSnapshot(request.dataSnapshot.snapshotId);

      if (loadedRef) {
        snapshotRef = loadedRef;
        logger.info(
          `[research.run] Loaded snapshot ${snapshotRef.snapshotId} for manifest (content hash: ${snapshotRef.contentHash.substring(0, 8)}...)`
        );
      } else {
        logger.warn(
          `[research.run] Snapshot ${request.dataSnapshot.snapshotId} not found in snapshot storage. ` +
            `Manifest will be created without snapshotRef (backward compatibility).`
        );
      }
    } catch (error) {
      logger.warn(
        `[research.run] Failed to load snapshot ${request.dataSnapshot.snapshotId}: ${
          error instanceof Error ? error.message : String(error)
        }. Manifest will be created without snapshotRef (backward compatibility).`
      );
    }
  }

  // Return result with _manifest property containing snapshotRef
  // This allows execute() to extract it and create a proper RunManifest
  return {
    runId: artifact.metadata.runId,
    artifact,
    // Include snapshotRef in _manifest for RunManifest creation
    _manifest: {
      snapshotRef,
      strategyConfig: request.strategy.config,
      executionModel: request.executionModel,
      costModel: request.costModel,
      riskModel: request.riskModel,
      seed: request.runConfig.seed,
      engineVersion: '1.0.0',
    },
  };
}
