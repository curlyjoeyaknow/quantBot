/**
 * Execution Model Interface
 *
 * Executes trades with realistic constraints:
 * - Latency
 * - Slippage
 * - Partial fills
 * - Failed transactions
 * - Fee regimes
 */

import type { ExecutionModel } from '../types/execution-model.js';
import type { DeterministicRNG } from '@quantbot/core';

/**
 * Trade request
 */
export interface TradeRequest {
  /**
   * Trade side
   */
  side: 'buy' | 'sell';

  /**
   * Requested quantity (token units)
   */
  quantity: number;

  /**
   * Requested price (USD per token)
   */
  price: number;

  /**
   * Current market state
   */
  marketState: {
    /**
     * Current market price
     */
    price: number;

    /**
     * Available liquidity
     */
    liquidity?: number;

    /**
     * Current volume
     */
    volume?: number;
  };
}

/**
 * Execution result
 */
export interface ExecutionResult {
  /**
   * Whether execution succeeded
   */
  success: boolean;

  /**
   * Executed price (may differ from requested due to slippage)
   */
  executedPrice: number;

  /**
   * Executed quantity (may be less than requested due to partial fills)
   */
  executedQuantity: number;

  /**
   * Slippage (basis points)
   */
  slippageBps: number;

  /**
   * Fees (USD)
   */
  fees: number;

  /**
   * Execution latency (milliseconds)
   */
  latencyMs: number;

  /**
   * Whether this was a partial fill
   */
  partialFill: boolean;

  /**
   * Error message if execution failed
   */
  error?: string;
}

/**
 * Execution model interface
 */
export interface ExecutionModelInterface {
  /**
   * Execute a trade
   * 
   * @param trade - Trade request
   * @param rng - Deterministic random number generator
   * @returns Execution result
   */
  execute(trade: TradeRequest, rng: DeterministicRNG): ExecutionResult;

  /**
   * Get execution model configuration
   */
  getConfig(): ExecutionModel;
}

