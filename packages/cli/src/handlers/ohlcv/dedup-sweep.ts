/**
 * Handler for OHLCV dedup sweep command.
 * Runs deduplication sweep across all interval tables.
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { dedupSweepSchema } from '../../commands/ohlcv.js';

export type DedupSweepArgs = z.infer<typeof dedupSweepSchema>;

export async function dedupSweepHandler(args: DedupSweepArgs, ctx: CommandContext) {
  const service = ctx.services.ohlcvDedup();

  const options = {
    intervals: args.intervals,
    olderThan: args.olderThan ? new Date(args.olderThan) : undefined,
    dryRun: args.dryRun,
  };

  return await service.deduplicateSweep(options);
}
