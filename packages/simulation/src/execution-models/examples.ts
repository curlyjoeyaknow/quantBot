/**
 * Example Execution Model Configurations
 * =======================================
 *
 * Pre-configured execution models for common venues and scenarios.
 * These can be used as starting points or references.
 */

import type { ExecutionModel, RiskFramework } from './types.js';
import {
  createPumpfunExecutionModel,
  createPumpswapExecutionModel,
  createMinimalExecutionModel,
} from './models.js';
import { createDefaultRiskFramework } from './risk.js';

/**
 * Get a pre-configured execution model by name
 */
export function getExecutionModel(name: string): ExecutionModel {
  switch (name.toLowerCase()) {
    case 'pumpfun':
    case 'pump.fun':
      return createPumpfunExecutionModel();
    case 'pumpswap':
    case 'pump-swap':
      return createPumpswapExecutionModel();
    case 'minimal':
      return createMinimalExecutionModel();
    default:
      throw new Error(`Unknown execution model: ${name}`);
  }
}

/**
 * Get a pre-configured risk framework
 */
export function getRiskFramework(name: string = 'default'): RiskFramework {
  switch (name.toLowerCase()) {
    case 'default':
      return createDefaultRiskFramework();
    case 'conservative':
      return {
        circuitBreakers: {
          maxDrawdown: 0.1, // 10% max drawdown
          maxDailyLoss: 500,
          maxConsecutiveLosses: 3,
          maxExposurePerStrategy: 2500,
          maxTotalExposure: 10000,
          minTradeIntervalSeconds: 5,
          maxTradesPerHour: 50,
          maxTradesPerDay: 200,
        },
        anomalyDetection: {
          enabled: true,
          latencySpikeThreshold: 2,
          slippageSpikeThreshold: 2,
          failureRateSpikeThreshold: 2,
          windowSizeSeconds: 300,
        },
      };
    case 'aggressive':
      return {
        circuitBreakers: {
          maxDrawdown: 0.3,
          maxDailyLoss: 2000,
          maxConsecutiveLosses: 10,
          maxExposurePerStrategy: 10000,
          maxTotalExposure: 50000,
          minTradeIntervalSeconds: 0,
          maxTradesPerHour: 200,
          maxTradesPerDay: 1000,
        },
        anomalyDetection: {
          enabled: true,
          latencySpikeThreshold: 5,
          slippageSpikeThreshold: 5,
          failureRateSpikeThreshold: 5,
          windowSizeSeconds: 600,
        },
      };
    default:
      return createDefaultRiskFramework();
  }
}

/**
 * Example: Conservative Pump.fun execution model
 */
export function createConservativePumpfunModel(): ExecutionModel {
  const model = createPumpfunExecutionModel();
  // Override with more conservative settings
  if (model.failures) {
    model.failures.maxFailureRate = 0.2; // Lower max failure rate
  }
  if (model.slippage) {
    model.slippage.entrySlippage.maxBps = 1000; // Higher max slippage
    model.slippage.exitSlippage.maxBps = 1000;
  }
  return model;
}

/**
 * Example: Aggressive PumpSwap execution model
 */
export function createAggressivePumpswapModel(): ExecutionModel {
  const model = createPumpswapExecutionModel();
  // Override with more aggressive settings
  if (model.failures) {
    model.failures.maxFailureRate = 0.35; // Higher tolerance
  }
  if (model.slippage) {
    model.slippage.entrySlippage.maxBps = 200; // Lower max slippage
    model.slippage.exitSlippage.maxBps = 200;
  }
  return model;
}
