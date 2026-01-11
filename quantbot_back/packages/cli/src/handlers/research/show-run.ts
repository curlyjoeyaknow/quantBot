/**
 * Show Research Run Handler
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { researchShowSchema } from '../../command-defs/research.js';
import { createExperimentContext } from '@quantbot/workflows';
import { logger } from '@quantbot/utils';

export type ShowRunArgs = z.infer<typeof researchShowSchema>;

/**
 * Show details of a specific simulation run
 */
export async function showRunHandler(args: ShowRunArgs, ctx: CommandContext) {
  await ctx.ensureInitialized();

  // Create experiment context
  const experimentCtx = createExperimentContext({
    artifactBaseDir: process.cwd(),
  });

  // Load artifact
  const artifact = await experimentCtx.artifacts.load(args.runId);

  if (!artifact) {
    logger.warn(`[research.show] Run ${args.runId} not found`);
    return {
      found: false,
      runId: args.runId,
    };
  }

  logger.info(`[research.show] Loaded run ${args.runId}`);

  return {
    found: true,
    artifact,
  };
}
