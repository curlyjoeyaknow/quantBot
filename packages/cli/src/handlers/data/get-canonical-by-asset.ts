/**
 * Get Canonical Events by Asset Handler
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { canonicalGetByAssetSchema } from '../../command-defs/data.js';

export type GetCanonicalByAssetArgs = z.infer<typeof canonicalGetByAssetSchema>;

export async function getCanonicalByAssetHandler(
  args: GetCanonicalByAssetArgs,
  ctx: CommandContext
): Promise<{ events: unknown[] }> {
  const repository = ctx.services.canonicalRepository();

  const timeRange =
    args.from || args.to
      ? {
          from: args.from || '',
          to: args.to || '',
        }
      : undefined;

  const events = await repository.getByAsset(args.assetAddress, timeRange, args.eventTypes);

  return {
    events,
  };
}

