/**
 * Perfect Fill Model
 *
 * Executes trades instantly with no slippage (for comparison/testing only).
 * NOT for production simulations - use realistic execution models instead.
 */

import type { ExecutionModelInterface, TradeRequest, ExecutionResult } from '../execution-model.js';
import type { ExecutionModel } from '../../types/execution-model.js';
import type { DeterministicRNG } from '@quantbot/core';

export class PerfectFillModel implements ExecutionModelInterface {
  constructor(private readonly config: ExecutionModel) {}

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
