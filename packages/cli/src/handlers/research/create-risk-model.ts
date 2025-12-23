/**
 * Create Risk Model Handler
 *
 * Creates a risk model from constraints using ExecutionRealityService.
 */

import type { CommandContext } from '../../core/command-context.js';
import { ExecutionRealityService } from '@quantbot/workflows';
import { createProductionContext } from '@quantbot/workflows';
import type { z } from 'zod';

export type CreateRiskModelArgs = z.infer<
  typeof import('../../command-defs/research.js').createRiskModelSchema
>;

export async function createRiskModelHandler(args: CreateRiskModelArgs, ctx: CommandContext) {
  // Create service (doesn't require context)
  const executionService = new ExecutionRealityService();

  // Create risk model
  const model = executionService.createRiskModelFromConstraints({
    maxDrawdownPercent: args.maxDrawdownPercent || 20,
    maxLossPerDay: args.maxLossPerDay || 1000,
    maxConsecutiveLosses: args.maxConsecutiveLosses || 5,
    maxPositionSize: args.maxPositionSize || 500,
  });

  return model;
}
