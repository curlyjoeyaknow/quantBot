/**
 * Perfect Fill Model
 *
 * Executes trades instantly with no slippage (for comparison/testing only).
 * NOT for production simulations - use realistic execution models instead.
 */

import type { ExecutionModelInterface, TradeRequest, ExecutionResult } from '../execution-model.js';
import type { ExecutionModel } from '../../types/execution-model.js';
import type { DeterministicRNG } from '@quantbot/core';
import { ExecutionModelSchema } from '../../types/execution-model.js';

export class PerfectFillModel implements ExecutionModelInterface {
  private readonly config: ExecutionModel;

  constructor(config: ExecutionModel = {}) {
    // Validate and store config
    this.config = ExecutionModelSchema.parse(config);
  }

  execute(trade: TradeRequest, _rng: DeterministicRNG): ExecutionResult {
    // Perfect execution: no slippage, no latency, no fees, full fill
    return {
      success: true,
      executedPrice: trade.price,
      executedQuantity: trade.quantity,
      slippageBps: 0,
      fees: 0,
      latencyMs: 0,
      partialFill: false,
    };
  }

  getConfig(): ExecutionModel {
    return this.config;
  }
}
