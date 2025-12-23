/**
 * Find Experiments by Parameter Hash Handler
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { findExperimentsByParameterSchema } from '../../command-defs/experiments.js';

export type FindExperimentsByParameterArgs = z.infer<typeof findExperimentsByParameterSchema>;

export async function findExperimentsByParameterHandler(
  args: FindExperimentsByParameterArgs,
  ctx: CommandContext
): Promise<unknown[]> {
  const repository = ctx.services.experimentRepository();

  const experiments = await repository.getByParameterHash(args.parameterHash, args.limit);

  return experiments;
}

