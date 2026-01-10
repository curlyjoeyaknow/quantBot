/**
 * Create Cost Model Handler
 *
 * Creates a cost model from fee data using ExecutionRealityService.
 */

import type { CommandContext } from '../../core/command-context.js';
import { ExecutionRealityService } from '@quantbot/workflows';
import type { z } from 'zod';

export type CreateCostModelArgs = z.infer<
  typeof import('../../command-defs/research.js').createCostModelSchema
>;

export async function createCostModelHandler(args: CreateCostModelArgs, ctx: CommandContext) {
  // Create service (doesn't require context)
  const executionService = new ExecutionRealityService();

  // Create cost model
  const model = executionService.createCostModelFromFees({
    baseFee: args.baseFee || 5000,
    priorityFeeRange: {
      min: args.priorityFeeMin || 1000,
      max: args.priorityFeeMax || 10000,
    },
    tradingFeePercent: args.tradingFeePercent || 0.01,
  });

  return model;
}
