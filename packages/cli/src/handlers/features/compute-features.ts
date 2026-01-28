/**
 * Compute Features Handler
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { featuresComputeSchema } from '../../command-defs/features.js';

export type ComputeFeaturesArgs = z.infer<typeof featuresComputeSchema>;

export async function computeFeaturesHandler(
  args: ComputeFeaturesArgs,
  ctx: CommandContext
): Promise<{ featureSetId: string; computed: boolean }> {
  const featureStore = ctx.services.featureStore();

  // TODO: Get data from canonical repository or other source based on time range
  // For now, this is a placeholder
  const data = {}; // Would be populated from canonical events, candles, etc.

  const result = await featureStore.compute(args.featureSet, data);

  return {
    featureSetId: result.featureSetId,
    computed: true,
  };
}
