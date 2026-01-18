/**
 * Leaderboard Handler
 */

import type { z } from 'zod';
import { researchLeaderboardSchema } from '../../command-defs/research.js';
import type { CommandContext } from '../../core/command-context.js';
import { getLeaderboard, createExperimentContext } from '@quantbot/workflows';
import { logger } from '@quantbot/infra/utils';

export type LeaderboardArgs = z.infer<typeof researchLeaderboardSchema>;

/**
 * Show leaderboard of simulation runs
 */
export async function leaderboardHandler(args: LeaderboardArgs, ctx: CommandContext) {
  await ctx.ensureInitialized();

  logger.info(`[research.leaderboard] Generating leaderboard`, {
    criteria: args.criteria,
    order: args.order,
    limit: args.limit,
  });

  // Create experiment context
  const experimentCtx = createExperimentContext({
    artifactBaseDir: process.cwd(),
  });

  // Get leaderboard
  const entries = await getLeaderboard(experimentCtx, {
    criteria: args.criteria,
    order: args.order,
    limit: args.limit,
    strategyName: args.strategyName,
    snapshotId: args.snapshotId,
    minReturn: args.minReturn,
    minWinRate: args.minWinRate,
  });

  logger.info(`[research.leaderboard] Found ${entries.length} runs`);

  return {
    entries,
    total: entries.length,
    criteria: args.criteria,
    order: args.order,
  };
}
