/**
 * Handler for OHLCV runs details command.
 * Get detailed information about a specific run.
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { runsDetailsSchema } from '../../commands/ohlcv.js';

export type RunsDetailsArgs = z.infer<typeof runsDetailsSchema>;

export async function runsDetailsHandler(args: RunsDetailsArgs, ctx: CommandContext) {
  const repository = ctx.services.ingestionRunRepository();

  return await repository.getRunDetails(args.runId);
}
