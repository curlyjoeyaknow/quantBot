/**
 * Execution Model Factory
 *
 * Creates ExecutionModelInterface instances from ExecutionModel config.
 * This bridges the contract schema (ExecutionModel) with the runtime interface (ExecutionModelInterface).
 */

import type { ExecutionModel } from '../execution-models/types.js';
import type { ExecutionModelInterface } from './execution-model.js';
import { PerfectFillModel } from './models/perfect-fill-model.js';
import { FixedSlippageModel } from './models/fixed-slippage-model.js';
import { ExecutionModelSchema } from '../execution-models/types.js';
import { createMinimalExecutionModel } from '../execution-models/models.js';

/**
 * Creates an ExecutionModelInterface from an ExecutionModel config.
 *
 * @param config - Execution model configuration (from contract)
 * @returns Execution model interface instance
 */
export function createExecutionModel(config: ExecutionModel): ExecutionModelInterface {
  // Validate config
  const validatedConfig = ExecutionModelSchema.parse(config);

  // If slippage is fixed, use FixedSlippageModel
  if (validatedConfig.slippage.entrySlippage.type === 'fixed') {
    const slippageBps = validatedConfig.slippage.entrySlippage.fixedBps ?? 0;
    return new FixedSlippageModel(validatedConfig, slippageBps);
  }

  // For now, fall back to FixedSlippageModel for other slippage types
  // TODO: Implement models for linear, sqrt, volume-based slippage
  // This will require implementing the full execution model logic from execution-models/
  const defaultSlippageBps = 10; // Default 0.1% slippage
  return new FixedSlippageModel(validatedConfig, defaultSlippageBps);
}

/**
 * Creates a default execution model (perfect fill) if none is provided.
 * This ensures backward compatibility when executionModel is optional in SimInput.
 */
export function createDefaultExecutionModel(): ExecutionModelInterface {
  const defaultConfig = createMinimalExecutionModel();
  return new PerfectFillModel(defaultConfig);
}
