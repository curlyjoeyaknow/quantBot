/**
 * List Features Handler
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { featuresListSchema } from '../../command-defs/features.js';
export type ListFeaturesArgs = z.infer<typeof featuresListSchema>;

export async function listFeaturesHandler(
  args: ListFeaturesArgs,
  _ctx: CommandContext
): Promise<{ features: unknown[]; total: number }> {
  // Lazy import to avoid circular dependencies
  const { featureRegistry } = await import('@quantbot/analytics');
  const features = featureRegistry.list();

  return {
    features: features.map((f) => ({
      featureSetId: f.featureSetId,
      name: f.name,
      version: f.version,
      dependencies: f.dependencies,
      assumptions: f.metadata.assumptions,
    })),
    total: features.length,
  };
}
