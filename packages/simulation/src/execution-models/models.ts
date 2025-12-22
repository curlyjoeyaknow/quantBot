/**
 * Execution Model Factory
 * ========================
 *
 * Factory functions to create complete execution models for different venues.
 */

import type { ExecutionModel } from './types.js';
import { createPumpfunLatencyConfig, createPumpswapLatencyConfig } from './latency.js';
import { createPumpfunSlippageConfig, createPumpswapSlippageConfig } from './slippage.js';
import {
  createPumpfunFailureModel,
  createPumpfunPartialFillModel,
  createSolanaReorgModel,
} from './failures.js';
import { createPumpfunCostModel, createPumpswapCostModel } from './costs.js';

/**
 * Create a complete execution model for Pump.fun
 */
export function createPumpfunExecutionModel(): ExecutionModel {
  return {
    id: 'pumpfun-default',
    name: 'Pump.fun Default Execution Model',
    venue: 'pumpfun',
    latency: createPumpfunLatencyConfig(),
    slippage: createPumpfunSlippageConfig(),
    failures: createPumpfunFailureModel(),
    partialFills: createPumpfunPartialFillModel(),
    reorgs: createSolanaReorgModel(),
    costs: createPumpfunCostModel(),
  };
}

/**
 * Create a complete execution model for PumpSwap (post-graduation)
 */
export function createPumpswapExecutionModel(): ExecutionModel {
  return {
    id: 'pumpswap-default',
    name: 'PumpSwap Default Execution Model',
    venue: 'pumpswap',
    latency: createPumpswapLatencyConfig(),
    slippage: createPumpswapSlippageConfig(),
    failures: {
      baseFailureRate: 0.01, // Lower failure rate
      congestionFailureRate: 0.03,
      feeShortfallFailureRate: 0.08,
      maxFailureRate: 0.25,
    },
    partialFills: {
      probability: 0.02, // Lower partial fill probability
      fillDistribution: {
        type: 'uniform',
        minFill: 0.6,
        maxFill: 0.98,
      },
    },
    reorgs: createSolanaReorgModel(),
    costs: createPumpswapCostModel(),
  };
}

/**
 * Create a minimal execution model (for testing or simple simulations)
 */
export function createMinimalExecutionModel(venue: string = 'minimal'): ExecutionModel {
  return {
    id: 'minimal',
    name: 'Minimal Execution Model',
    venue,
    latency: {
      venue,
      networkLatency: {
        p50: 0,
        p90: 0,
        p99: 0,
        jitterMs: 0,
        distribution: 'percentile',
      },
      confirmationLatency: {
        p50: 0,
        p90: 0,
        p99: 0,
        jitterMs: 0,
        distribution: 'percentile',
      },
      congestionMultiplier: 1,
    },
    slippage: {
      venue,
      entrySlippage: {
        type: 'fixed',
        fixedBps: 0,
        linearCoefficient: 0,
        sqrtCoefficient: 0,
        volumeImpactBps: 0,
        minBps: 0,
        maxBps: 0,
      },
      exitSlippage: {
        type: 'fixed',
        fixedBps: 0,
        linearCoefficient: 0,
        sqrtCoefficient: 0,
        volumeImpactBps: 0,
        minBps: 0,
        maxBps: 0,
      },
      volatilityMultiplier: 1,
    },
    costs: {
      takerFeeBps: 0,
      makerFeeBps: 0,
      borrowAprBps: 0,
    },
  };
}
