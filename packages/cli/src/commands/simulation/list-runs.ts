import { DateTime } from 'luxon';
import type { CommandContext } from '../../core/command-context.js';
import type { ListRunsArgs } from '../../command-defs/simulation.js';
import type { RunWithStatus } from '@quantbot/core';

export async function listRunsHandler(
  args: ListRunsArgs,
  ctx: CommandContext
): Promise<RunWithStatus[]> {
  await ctx.ensureInitialized();
  const runRepo = ctx.services.runRepository();

  const filters = {
    from: args.from ? DateTime.fromISO(args.from, { zone: 'utc' }) : undefined,
    to: args.to ? DateTime.fromISO(args.to, { zone: 'utc' }) : undefined,
    limit: args.limit,
  };

  return await runRepo.listRuns(filters);
}
