/**
 * Execution Config Factory
 *
 * Creates execution configurations from venue names or simple fee parameters.
 * Bridges CLI options to the policy executor's ExecutionConfig type.
 */

import type { ExecutionConfig, FeeConfig } from '../policies/policy-executor.js';
import {
  createPumpfunExecutionModel,
  createPumpswapExecutionModel,
  createMinimalExecutionModel,
} from '@quantbot/simulation/execution-models';

/**
 * Supported execution model venues
 */
export type ExecutionModelVenue = 'pumpfun' | 'pumpswap' | 'raydium' | 'minimal' | 'simple';

/**
 * Create execution config from venue name or simple fee parameters
 *
 * @param venue - Execution model venue or 'simple' for fixed fees
 * @param simpleFees - Simple fee config (used when venue is 'simple' or as fallback)
 * @returns ExecutionConfig for use with executePolicy
 */
export function createExecutionConfig(
  venue: ExecutionModelVenue,
  simpleFees: FeeConfig = { takerFeeBps: 30, slippageBps: 10 }
): ExecutionConfig {
  if (venue === 'simple') {
    // Use simple fixed fees
    return simpleFees;
  }

  if (venue === 'minimal') {
    // Minimal model: zero slippage/latency for testing
    return {
      ...simpleFees,
      executionModel: createMinimalExecutionModel(),
    };
  }

  if (venue === 'pumpfun') {
    // PumpFun-specific execution model
    return {
      ...simpleFees,
      executionModel: createPumpfunExecutionModel(),
    };
  }

  if (venue === 'pumpswap') {
    // PumpSwap-specific execution model
    return {
      ...simpleFees,
      executionModel: createPumpswapExecutionModel(),
    };
  }

  if (venue === 'raydium') {
    // Raydium - use PumpSwap model as base (similar DEX mechanics)
    // TODO: Create dedicated Raydium model when data is available
    return {
      ...simpleFees,
      executionModel: createPumpswapExecutionModel(),
    };
  }

  // Fallback to simple fees
  return simpleFees;
}

/**
 * Get venue-specific description for display
 */
export function getVenueDescription(venue: ExecutionModelVenue): string {
  switch (venue) {
    case 'pumpfun':
      return 'PumpFun execution model (realistic slippage/latency)';
    case 'pumpswap':
      return 'PumpSwap execution model (realistic slippage/latency)';
    case 'raydium':
      return 'Raydium execution model (realistic slippage/latency)';
    case 'minimal':
      return 'Minimal model (zero slippage/latency for testing)';
    case 'simple':
    default:
      return 'Simple fixed fees (--taker-fee-bps, --slippage-bps)';
  }
}
