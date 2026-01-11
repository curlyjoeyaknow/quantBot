/**
 * Create Execution Model Handler
 *
 * Creates an execution model from calibration data using ExecutionRealityService.
 */

import type { CommandContext } from '../../core/command-context.js';
import { ExecutionRealityService } from '@quantbot/workflows';
import type { z } from 'zod';

export type CreateExecutionModelArgs = z.infer<
  typeof import('../../command-defs/research.js').createExecutionModelSchema
>;

export async function createExecutionModelHandler(
  args: CreateExecutionModelArgs,
  ctx: CommandContext
) {
  // Create service (doesn't require context)
  const executionService = new ExecutionRealityService();

  // Parse calibration data
  const latencySamples = args.latencySamples || [];

  // Handle slippage samples - if not provided, use default
  let slippageSamples = args.slippageSamples || [];
  if (slippageSamples.length === 0) {
    // Default slippage sample if none provided
    slippageSamples = [
      {
        tradeSize: 100,
        expectedPrice: 100.0,
        actualPrice: 100.1,
        marketVolume24h: 1000000,
      },
    ];
  }

  // Create execution model
  const model = executionService.createExecutionModelFromCalibration(
    {
      latencySamples: latencySamples.length > 0 ? latencySamples : [100, 200, 300], // Default if empty
      slippageSamples: slippageSamples.map((s) => ({
        tradeSize: s.tradeSize,
        expectedPrice: s.expectedPrice,
        actualPrice: s.actualPrice,
        marketVolume24h: s.marketVolume24h || 1000000,
      })),
      failureRate: args.failureRate || 0.01,
      partialFillRate: args.partialFillRate,
    },
    args.venue || 'pumpfun'
  );

  return model;
}
