/**
 * List Raw Data Sources Handler
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { rawDataListSchema } from '../../command-defs/data.js';

export type ListRawSourcesArgs = z.infer<typeof rawDataListSchema>;

export async function listRawSourcesHandler(
  _args: ListRawSourcesArgs,
  ctx: CommandContext
): Promise<{ sources: unknown[]; total: number }> {
  const repository = ctx.services.rawDataRepository();

  const sources = await repository.listSources();

  return {
    sources: sources.map((s) => ({
      sourceType: s.sourceType,
      sourceId: s.sourceId,
      recordCount: s.recordCount,
    })),
    total: sources.length,
  };
}

