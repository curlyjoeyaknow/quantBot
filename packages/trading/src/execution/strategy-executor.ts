/**
 * Strategy Executor
 * 
 * Converts simulation strategies to trade orders with position sizing
 */

import { Strategy, StopLossConfig } from '@quantbot/simulation';
import { logger } from '@quantbot/utils';
import type { TradeOrder, TakeProfitTarget } from '../types';

export interface StrategyExecutionParams {
  strategy: Strategy[];
  entryPrice: number;
  walletBalance: number; // Total SOL balance
  tokenMint: string;
  chain: string;
  stopLossConfig?: StopLossConfig;
  maxPositionSize?: number; // Maximum position size in SOL
}

/**
 * Strategy Executor - converts strategies to trade orders
 */
export class StrategyExecutor {
  /**
   * Execute a strategy and generate trade orders
   */
  executeStrategy(params: StrategyExecutionParams): TradeOrder[] {
    const {
      strategy,
      entryPrice,
      walletBalance,
      tokenMint,
      chain,
      stopLossConfig,
      maxPositionSize,
    } = params;

    const orders: TradeOrder[] = [];

    // Calculate total position size based on strategy
    // Sum all percentages to get total allocation
    const totalAllocation = strategy.reduce((sum, leg) => sum + leg.percent, 0);
    
    // Determine position size
    let positionSize = walletBalance * totalAllocation;
    
    // Apply max position size limit if specified
    if (maxPositionSize && positionSize > maxPositionSize) {
      positionSize = maxPositionSize;
      logger.warn('Position size limited by maxPositionSize', {
        requested: walletBalance * totalAllocation,
        max: maxPositionSize,
        actual: positionSize,
      });
    }

    // Generate buy order for entry
    const buyOrder: TradeOrder = {
      type: 'buy',
      tokenMint,
      chain,
      amount: positionSize, // Amount in SOL
      expectedPrice: entryPrice,
      slippageTolerance: 0.01, // 1% default slippage
    };

    orders.push(buyOrder);

    // Generate sell orders for take-profit targets
    for (const leg of strategy) {
      const targetPrice = entryPrice * leg.target;
      const sellAmount = positionSize * leg.percent; // Amount in SOL to sell at this target

      const sellOrder: TradeOrder = {
        type: 'sell',
        tokenMint,
        chain,
        amount: sellAmount, // This will be converted to token amount at execution time
        expectedPrice: targetPrice,
        slippageTolerance: 0.01,
        takeProfitTarget: leg.target,
      };

      orders.push(sellOrder);
    }

    // Add stop-loss order if configured
    if (stopLossConfig && typeof stopLossConfig.initial === 'number') {
      const stopLossPrice = entryPrice * (1 + stopLossConfig.initial);
      const stopLossOrder: TradeOrder = {
        type: 'sell',
        tokenMint,
        chain,
        amount: positionSize, // Full position for stop-loss
        expectedPrice: stopLossPrice,
        slippageTolerance: 0.02, // Higher slippage tolerance for stop-loss
        stopLossPrice,
      };

      orders.push(stopLossOrder);
    }

    return orders;
  }

  /**
   * Calculate position size for a specific target
   */
  calculatePositionSize(
    target: TakeProfitTarget,
    totalBalance: number,
    totalAllocation: number
  ): number {
    // Position size = total balance * total allocation * target percentage
    return totalBalance * totalAllocation * target.percent;
  }

  /**
   * Convert strategy legs to take-profit targets
   */
  convertToTakeProfitTargets(strategy: Strategy[]): TakeProfitTarget[] {
    return strategy.map((leg) => ({
      target: leg.target,
      percent: leg.percent,
      executed: false,
    }));
  }

  /**
   * Calculate total allocation percentage from strategy
   */
  calculateTotalAllocation(strategy: Strategy[]): number {
    return strategy.reduce((sum, leg) => sum + leg.percent, 0);
  }

  /**
   * Validate strategy before execution
   */
  validateStrategy(strategy: Strategy[]): { valid: boolean; error?: string } {
    if (!strategy || strategy.length === 0) {
      return { valid: false, error: 'Strategy is empty' };
    }

    const totalAllocation = this.calculateTotalAllocation(strategy);
    if (totalAllocation > 1.0) {
      return {
        valid: false,
        error: `Total allocation exceeds 100%: ${totalAllocation * 100}%`,
      };
    }

    if (totalAllocation <= 0) {
      return { valid: false, error: 'Total allocation must be greater than 0' };
    }

    // Check for duplicate targets
    const targets = strategy.map((leg) => leg.target);
    const uniqueTargets = new Set(targets);
    if (targets.length !== uniqueTargets.size) {
      return { valid: false, error: 'Strategy contains duplicate targets' };
    }

    // Validate target values
    for (const leg of strategy) {
      if (leg.target <= 1.0) {
        return {
          valid: false,
          error: `Target must be greater than 1.0x, got ${leg.target}x`,
        };
      }
      if (leg.percent <= 0 || leg.percent > 1) {
        return {
          valid: false,
          error: `Percent must be between 0 and 1, got ${leg.percent}`,
        };
      }
    }

    return { valid: true };
  }
}

