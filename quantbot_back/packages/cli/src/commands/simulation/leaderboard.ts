import { DateTime } from 'luxon';
import type { CommandContext } from '../../core/command-context.js';
import type { LeaderboardEntry } from '@quantbot/core';
import type { LeaderboardArgs } from '../../command-defs/simulation.js';

export async function leaderboardHandler(
  args: LeaderboardArgs,
  ctx: CommandContext
): Promise<LeaderboardEntry[]> {
  await ctx.ensureInitialized();
  const runRepo = ctx.services.runRepository();

  const filters = {
    strategy_id: args.strategy_id,
    interval_sec: args.interval_sec,
    from: args.from ? DateTime.fromISO(args.from, { zone: 'utc' }) : undefined,
    to: args.to ? DateTime.fromISO(args.to, { zone: 'utc' }) : undefined,
    min_trades: args.min_trades,
    limit: args.limit || 50,
  };

  return await runRepo.leaderboard(filters);
}
