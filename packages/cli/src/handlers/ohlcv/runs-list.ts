/**
 * Handler for OHLCV runs list command.
 * Lists ingestion runs with optional filtering.
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { runsListSchema } from '../../commands/ohlcv.js';

export type RunsListArgs = z.infer<typeof runsListSchema>;

export async function runsListHandler(args: RunsListArgs, ctx: CommandContext) {
  const repository = ctx.services.ingestionRunRepository();

  const options = {
    status: args.status,
    since: args.since ? new Date(args.since) : undefined,
    limit: args.limit,
  };

  return await repository.getRunHistory(options);
}
