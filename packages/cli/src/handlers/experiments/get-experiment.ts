/**
 * Get Experiment Handler
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { getExperimentSchema } from '../../command-defs/experiments.js';

export type GetExperimentArgs = z.infer<typeof getExperimentSchema>;

export async function getExperimentHandler(
  args: GetExperimentArgs,
  ctx: CommandContext
): Promise<unknown | null> {
  const repository = ctx.services.experimentRepository();

  const experiment = await repository.get(args.experimentId);

  if (!experiment) {
    return null;
  }

  return experiment;
}
