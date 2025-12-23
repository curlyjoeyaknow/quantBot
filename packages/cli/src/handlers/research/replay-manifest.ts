/**
 * Replay from Manifest Handler
 *
 * First-class command to re-run a simulation from a manifest file.
 * This is a key requirement for Phase 2: making RunManifest the spine.
 */

import { readFile } from 'fs/promises';
import type { z } from 'zod';
import { researchReplayManifestSchema } from '../../command-defs/research.js';
import type { CommandContext } from '../../core/command-context.js';
import { replaySimulation, createExperimentContext } from '@quantbot/workflows';
import { logger, ValidationError } from '@quantbot/utils';
import { CanonicalRunManifestSchema } from '@quantbot/workflows';

export type ReplayManifestArgs = z.infer<typeof researchReplayManifestSchema>;

/**
 * Replay a simulation from a manifest file
 *
 * This is the "first-class re-run" command that makes manifests the spine.
 * It:
 * 1. Loads the manifest file
 * 2. Extracts the run ID
 * 3. Replays the simulation using the existing replay infrastructure
 *
 * Future enhancement: Could also validate that the re-run produces the same results
 * (determinism check).
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

  // Validate manifest structure
  const validatedManifest = CanonicalRunManifestSchema.safeParse(manifest);
  if (!validatedManifest.success) {
    throw new ValidationError('Invalid manifest structure', {
      path: args.manifestFile,
      issues: validatedManifest.error.issues,
    });
  }

  const runId = validatedManifest.data.run_id;

  logger.info(`[research.replay-manifest] Replaying simulation ${runId} from manifest`);

  // Create experiment context
  const experimentCtx = createExperimentContext({
    artifactBaseDir: process.cwd(),
  });

  // Replay simulation using existing infrastructure
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
    artifact,
    manifest: validatedManifest.data,
  };
}
