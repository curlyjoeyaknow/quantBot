/**
 * Handler for OHLCV validate duplicates command.
 * Check for faulty runs with high error/corruption rates.
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { validateDuplicatesSchema } from '../../commands/ohlcv.js';

export type ValidateDuplicatesArgs = z.infer<typeof validateDuplicatesSchema>;

export async function validateDuplicatesHandler(args: ValidateDuplicatesArgs, ctx: CommandContext) {
  const service = ctx.services.ohlcvDedup();

  const options = {
    minErrorRate: args.minErrorRate,
    minZeroVolumeRate: args.minZeroVolumeRate,
    checkConsistency: args.checkConsistency,
  };

  return await service.identifyFaultyRuns(options);
}
