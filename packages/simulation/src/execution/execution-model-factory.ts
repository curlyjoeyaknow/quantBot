/**
 * Execution Model Factory
 *
 * Creates ExecutionModelInterface instances from ExecutionModel config.
 * This bridges the contract schema (ExecutionModel) with the runtime interface (ExecutionModelInterface).
 */

import type { ExecutionModel } from '../types/execution-model.js';
import type { ExecutionModelInterface } from './execution-model.js';
import { PerfectFillModel } from './models/perfect-fill-model.js';
import { FixedSlippageModel } from './models/fixed-slippage-model.js';
import { ExecutionModelSchema } from '../types/execution-model.js';

/**
 * Creates an ExecutionModelInterface from an ExecutionModel config.
 *
 * @param config - Execution model configuration (from contract)
 * @returns Execution model interface instance
 */
export function createExecutionModel(config: ExecutionModel): ExecutionModelInterface {
  // Validate config
  const validatedConfig = ExecutionModelSchema.parse(config);

  // If no slippage model is specified, use perfect fill (for backward compatibility)
  if (!validatedConfig.slippage) {
    return new PerfectFillModel(validatedConfig);
  }

  // If slippage is fixed, use FixedSlippageModel
  if (validatedConfig.slippage.type === 'fixed') {
    const slippageBps = (validatedConfig.slippage.params.bps as number) ?? 0;
    return new FixedSlippageModel(validatedConfig, slippageBps);
  }

  // For now, fall back to FixedSlippageModel for other slippage types
  // TODO: Implement models for linear, sqrt, constant_product slippage
  // This will require implementing the full execution model logic from execution-models/
  const defaultSlippageBps = 10; // Default 0.1% slippage
  return new FixedSlippageModel(validatedConfig, defaultSlippageBps);
}

/**
 * Creates a default execution model (perfect fill) if none is provided.
 * This ensures backward compatibility when executionModel is optional in SimInput.
 */
export function createDefaultExecutionModel(): ExecutionModelInterface {
  const defaultConfig: ExecutionModel = {
    // Empty config = perfect fill
  };
  return new PerfectFillModel(defaultConfig);
}

