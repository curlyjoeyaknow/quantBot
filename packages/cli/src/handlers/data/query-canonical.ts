/**
 * Query Canonical Events Handler
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { canonicalQuerySchema } from '../../command-defs/data.js';

export type QueryCanonicalArgs = z.infer<typeof canonicalQuerySchema>;

export async function queryCanonicalHandler(
  args: QueryCanonicalArgs,
  ctx: CommandContext
): Promise<{ events: unknown[]; total: number }> {
  const repository = ctx.services.canonicalRepository();

  const filter = {
    assetAddress: args.assetAddress,
    chain: args.chain,
    venueName: args.venueName,
    venueType: args.venueType,
    eventType: args.eventType,
    timeRange:
      args.from || args.to
        ? {
            from: args.from || '',
            to: args.to || '',
          }
        : undefined,
    sourceHash: args.sourceHash,
    sourceRunId: args.sourceRunId,
    limit: args.limit,
    offset: args.offset,
  };

  const result = await repository.query(filter);

  return {
    events: result.events,
    total: result.total,
  };
}

