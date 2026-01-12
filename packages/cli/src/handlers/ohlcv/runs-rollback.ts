/**
 * Handler for OHLCV runs rollback command.
 * Rollback (delete) all candles from a specific run.
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { runsRollbackSchema } from '../../commands/ohlcv.js';

export type RunsRollbackArgs = z.infer<typeof runsRollbackSchema>;

export async function runsRollbackHandler(args: RunsRollbackArgs, ctx: CommandContext) {
  const service = ctx.services.ohlcvDedup();

  return await service.rollbackRun(args.runId);
}
