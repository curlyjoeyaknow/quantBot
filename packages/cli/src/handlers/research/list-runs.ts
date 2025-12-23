/**
 * List Research Runs Handler
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { researchListSchema } from '../../command-defs/research.js';
import { createExperimentContext } from '@quantbot/workflows';
import { logger } from '@quantbot/utils';

export type ListRunsArgs = z.infer<typeof researchListSchema>;

/**
 * List all simulation runs
 */
export async function listRunsHandler(args: ListRunsArgs, ctx: CommandContext) {
  await ctx.ensureInitialized();

  // Create experiment context
  const experimentCtx = createExperimentContext({
    artifactBaseDir: process.cwd(),
  });

  // List runs
  const runIds = await experimentCtx.artifacts.list({
    limit: args.limit,
    offset: args.offset,
  });

  logger.info(`[research.list] Found ${runIds.length} runs`);

  return {
    runs: runIds,
    total: runIds.length,
    limit: args.limit,
    offset: args.offset,
  };
}
