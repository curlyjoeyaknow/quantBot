/**
 * Dry Run Executor
 * 
 * Simulates trades without execution for testing
 */

import { logger } from '@quantbot/utils';
import { TradeExecutor } from '../execution/trade-executor';
import { TransactionSender } from '../sender/transaction-sender';
import { TradeLogger } from '../logging/trade-logger';
import type { TradeResult, TradeOrder } from '../types';

export interface DryRunExecutorOptions {
  tradeExecutor: TradeExecutor;
  transactionSender: TransactionSender;
  tradeLogger: TradeLogger;
}

/**
 * Dry Run Executor - simulates trades without execution
 */
export class DryRunExecutor {
  private readonly tradeExecutor: TradeExecutor;
  private readonly transactionSender: TransactionSender;
  private readonly tradeLogger: TradeLogger;

  constructor(options: DryRunExecutorOptions) {
    this.tradeExecutor = options.tradeExecutor;
    this.transactionSender = options.transactionSender;
    this.tradeLogger = options.tradeLogger;
  }

  /**
   * Execute a trade in dry-run mode (simulation only)
   */
  async executeDryRun(
    order: TradeOrder,
    params: { userId: number; positionId?: number; [key: string]: any }
  ): Promise<TradeResult> {
    try {
      logger.info('DRY RUN: Simulating trade', { order });

      // For dry-run, we simulate the transaction but don't actually send it
      // We'll create a mock transaction for simulation
      // In a real implementation, we'd build the actual transaction and simulate it
      
      // For now, we'll just log and return a success result
      // The actual simulation would require building the transaction first
      // which is handled by TradeExecutor, so dry-run should wrap TradeExecutor calls

      // Log the would-be trade
      await this.tradeLogger.logTradeResult(
        params.userId,
        order,
        {
          success: true,
          executedPrice: order.expectedPrice,
          executedAmount: order.amount,
          slippage: 0,
        },
        params.positionId
      );

      return {
        success: true,
        executedPrice: order.expectedPrice,
        executedAmount: order.amount,
        slippage: 0,
      };
    } catch (error) {
      logger.error('Dry run execution failed', error as Error, { order });
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }
}

