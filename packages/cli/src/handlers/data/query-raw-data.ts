/**
 * Query Raw Data Handler
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { rawDataQuerySchema } from '../../command-defs/data.js';

export type QueryRawDataArgs = z.infer<typeof rawDataQuerySchema>;

export async function queryRawDataHandler(
  args: QueryRawDataArgs,
  ctx: CommandContext
): Promise<{ records: unknown[]; total: number }> {
  const repository = ctx.services.rawDataRepository();

  const filter = {
    sourceType: args.sourceType,
    sourceId: args.sourceId,
    hash: args.hash,
    timeRange:
      args.from && args.to
        ? {
            from: args.from,
            to: args.to,
          }
        : undefined,
  };

  const records = await repository.query(filter);

  return {
    records: records.map((r) => ({
      id: r.id,
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      hash: r.hash,
      runId: r.runId,
      ingestedAt: r.ingestedAt,
      contentLength: r.content.length,
      metadata: r.metadata,
    })),
    total: records.length,
  };
}

