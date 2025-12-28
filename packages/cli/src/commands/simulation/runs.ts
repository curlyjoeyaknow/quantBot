import type { CommandContext } from '../../core/command-context.js';
import type { RunWithStatus } from '@quantbot/core';

export async function runsHandler(ctx: CommandContext): Promise<RunWithStatus[]> {
  await ctx.ensureInitialized();
  const runRepo = ctx.services.runRepository();

  return await runRepo.listRuns({ limit: 20 });
}
