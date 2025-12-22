/**
 * Fixed Slippage Model
 *
 * Executes trades with constant slippage (basis points).
 */

import type { ExecutionModelInterface, TradeRequest, ExecutionResult } from '../execution-model.js';
import type { ExecutionModel } from '../../types/execution-model.js';
import type { DeterministicRNG } from '@quantbot/core';

export class FixedSlippageModel implements ExecutionModelInterface {
  private slippageBps: number;

  constructor(
    private readonly config: ExecutionModel,
    slippageBps?: number
  ) {
    // Extract slippage from config or use default
    const slippageParams = config.slippage?.params;
    this.slippageBps = slippageBps ?? (slippageParams?.bps as number) ?? 10; // Default 0.1%
  }

  execute(trade: TradeRequest, _rng: DeterministicRNG): ExecutionResult {
    // Apply fixed slippage
    const slippageMultiplier = 1 + this.slippageBps / 10000;
    const executedPrice =
      trade.side === 'buy'
        ? trade.price * slippageMultiplier // Pay more when buying
        : trade.price / slippageMultiplier; // Receive less when selling

    // Calculate fees from config
    const feeBps = this.config.fees?.takerFeeBps ?? 30; // Default 0.3%
    const fees = (executedPrice * trade.quantity * feeBps) / 10000;

    return {
      success: true,
      executedPrice,
      executedQuantity: trade.quantity,
      slippageBps: this.slippageBps,
      fees,
      latencyMs: 0, // TODO: Add latency from config
      partialFill: false,
    };
  }

  getConfig(): ExecutionModel {
    return this.config;
  }
}
