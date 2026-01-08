/**
 * Execution Model Adapters
 * ========================
 *
 * Adapter functions to bridge execution models with existing simulation engine.
 */

import type { CostConfig } from '../types/index.js';
import type { CostModel, ExecutionModel } from './types.js';

/**
 * Convert ExecutionModel's CostModel to legacy CostConfig
 *
 * This bridges the new execution models with the existing simulation engine.
 * Note: Dynamic slippage from ExecutionModel is not included in CostConfig,
 * so this only converts the base fee structure.
 */
export function convertCostModelToCostConfig(costModel: CostModel): CostConfig {
  return {
    entrySlippageBps: 0, // Slippage is handled dynamically by ExecutionModel
    exitSlippageBps: 0, // Slippage is handled dynamically by ExecutionModel
    takerFeeBps: costModel.takerFeeBps,
    borrowAprBps: costModel.borrowAprBps,
  };
}

/**
 * Convert ExecutionModel to CostConfig for simulation engine
 *
 * This is a convenience function that extracts the cost model and converts it.
 */
export function convertExecutionModelToCostConfig(model: ExecutionModel): CostConfig {
  return convertCostModelToCostConfig(model.costs);
}

/**
 * Calculate effective slippage from ExecutionModel for a specific trade
 *
 * This can be used to dynamically set slippage in CostConfig if needed.
 */
export function calculateEffectiveSlippageBps(
  model: ExecutionModel,
  tradeSize: number,
  isEntry: boolean,
  marketVolume24h: number = 0,
  volatilityLevel: number = 0
): number {
  if (isEntry) {
    return calculateEntrySlippage(model.slippage, tradeSize, marketVolume24h, volatilityLevel);
  } else {
    return calculateExitSlippage(model.slippage, tradeSize, marketVolume24h, volatilityLevel);
  }
}

// Re-export for convenience
import { calculateEntrySlippage, calculateExitSlippage } from './slippage.js';
