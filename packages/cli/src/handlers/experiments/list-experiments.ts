/**
 * List Experiments Handler
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { listExperimentsSchema } from '../../command-defs/experiments.js';

export type ListExperimentsArgs = z.infer<typeof listExperimentsSchema>;

export async function listExperimentsHandler(
  args: ListExperimentsArgs,
  ctx: CommandContext
): Promise<{ experiments: unknown[]; total: number }> {
  const repository = ctx.services.experimentRepository();

  const filter = {
    experimentId: args.experimentId,
    strategyId: args.strategyId,
    parameterVectorHash: args.parameterHash,
    gitCommitHash: args.gitCommit,
    dataSnapshotHash: args.dataSnapshot,
    status: args.status,
    startedAfter: args.startedAfter,
    startedBefore: args.startedBefore,
    limit: args.limit,
    offset: args.offset,
  };

  const result = await repository.list(filter);

  return {
    experiments: result.experiments,
    total: result.total,
  };
}
