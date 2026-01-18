/**
 * Replay Research Simulation Handler
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { researchReplaySchema } from '../../command-defs/research.js';
import { replaySimulation, createExperimentContext } from '@quantbot/workflows';
import { logger } from '@quantbot/infra/utils';

export type ReplaySimulationArgs = z.infer<typeof researchReplaySchema>;

/**
 * Replay a simulation by run ID
 */
export async function replaySimulationHandler(args: ReplaySimulationArgs, ctx: CommandContext) {
  await ctx.ensureInitialized();

  logger.info(`[research.replay] Replaying simulation ${args.runId}`);

  // Create experiment context
  const experimentCtx = createExperimentContext({
    artifactBaseDir: process.cwd(),
  });

  // Replay simulation
  const artifact = await replaySimulation(args.runId, experimentCtx);

  logger.info(`[research.replay] Completed replay ${artifact.metadata.runId}`);

  return {
    runId: artifact.metadata.runId,
    artifact,
  };
}
