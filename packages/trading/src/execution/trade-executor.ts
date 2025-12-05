/**
 * Trade Executor
 * 
 * Executes buy/sell orders with stop-loss and take-profit logic
 */

import { PublicKey, Keypair } from '@solana/web3.js';
import { logger } from '@quantbot/utils';
import { TransactionBuilder } from '../builders/transaction-builder';
import { TransactionSender } from '../sender/transaction-sender';
import type { TradeOrder, TradeResult, Position } from '../types';

export interface TradeExecutionParams {
  order: TradeOrder;
  payer: PublicKey;
  payerKeypair: Keypair;
  creator?: PublicKey; // For Pump.fun
  tokenProgram?: PublicKey; // Legacy or Token-2022
  useRelayer?: boolean;
}

/**
 * Trade Executor - executes trade orders
 */
export class TradeExecutor {
  private readonly transactionBuilder: TransactionBuilder;
  private readonly transactionSender: TransactionSender;

  constructor(transactionBuilder: TransactionBuilder, transactionSender: TransactionSender) {
    this.transactionBuilder = transactionBuilder;
    this.transactionSender = transactionSender;
  }

  /**
   * Execute a buy order
   */
  async executeBuy(params: TradeExecutionParams): Promise<TradeResult> {
    const { order, payer, payerKeypair, creator, tokenProgram, useRelayer } = params;

    try {
      // Convert SOL amount to lamports
      const solAmount = Math.floor(order.amount * 1e9); // SOL to lamports
      const maxSolCost = Math.floor(solAmount * (1 + order.slippageTolerance));

      if (!creator) {
        throw new Error('Creator address required for Pump.fun buy');
      }

      // Build transaction
      const transaction = await this.transactionBuilder.buildPumpfunBuy({
        payer,
        tokenMint: new PublicKey(order.tokenMint),
        creator,
        solAmount,
        maxSolCost,
        tokenProgram,
      });

      // Add compute budget
      this.transactionBuilder.addComputeBudget(transaction, 200_000, 21_000);

      // Send transaction
      if (useRelayer) {
        return this.transactionSender.sendViaRelayer(transaction, [payerKeypair]);
      } else {
        return this.transactionSender.send(transaction, [payerKeypair], {
          skipPreflight: false,
          commitment: 'confirmed',
        });
      }
    } catch (error) {
      logger.error('Buy order execution failed', error as Error, { order });
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Execute a sell order
   */
  async executeSell(params: TradeExecutionParams & { tokenAmount: number }): Promise<TradeResult> {
    const {
      order,
      payer,
      payerKeypair,
      creator,
      tokenProgram,
      tokenAmount,
      useRelayer,
    } = params;

    try {
      if (!creator) {
        throw new Error('Creator address required for Pump.fun sell');
      }

      // Calculate minimum SOL output with slippage
      const expectedSolOutput = order.expectedPrice * tokenAmount;
      const minSolOutput = Math.floor(
        expectedSolOutput * (1 - order.slippageTolerance) * 1e9
      ); // Convert to lamports

      // Build transaction
      const transaction = await this.transactionBuilder.buildPumpfunSell({
        payer,
        tokenMint: new PublicKey(order.tokenMint),
        creator,
        tokenAmount: Math.floor(tokenAmount),
        minSolOutput,
        tokenProgram,
      });

      // Add compute budget
      this.transactionBuilder.addComputeBudget(transaction, 200_000, 21_000);

      // Send transaction
      if (useRelayer) {
        return this.transactionSender.sendViaRelayer(transaction, [payerKeypair]);
      } else {
        return this.transactionSender.send(transaction, [payerKeypair], {
          skipPreflight: false,
          commitment: 'confirmed',
        });
      }
    } catch (error) {
      logger.error('Sell order execution failed', error as Error, { order });
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Execute a stop-loss order
   */
  async executeStopLoss(
    position: Position,
    params: Omit<TradeExecutionParams, 'order'> & { currentPrice: number }
  ): Promise<TradeResult> {
    const { payer, payerKeypair, creator, tokenProgram, currentPrice, useRelayer } = params;

    // Calculate token amount from remaining position size
    const tokenAmount = position.remainingSize / position.entryPrice;

    const order: TradeOrder = {
      type: 'sell',
      tokenMint: position.tokenMint,
      chain: position.chain,
      amount: position.remainingSize,
      expectedPrice: position.stopLossPrice || currentPrice,
      slippageTolerance: 0.02, // Higher slippage tolerance for stop-loss
      stopLossPrice: position.stopLossPrice,
    };

    return this.executeSell({
      order,
      payer,
      payerKeypair,
      creator,
      tokenProgram,
      tokenAmount,
      useRelayer,
    });
  }

  /**
   * Execute a take-profit order (partial sell)
   */
  async executeTakeProfit(
    position: Position,
    target: TakeProfitTarget,
    params: Omit<TradeExecutionParams, 'order'> & { currentPrice: number }
  ): Promise<TradeResult> {
    const { payer, payerKeypair, creator, tokenProgram, currentPrice, useRelayer } = params;

    // Calculate amount to sell based on target percentage
    const sellAmount = position.remainingSize * target.percent;
    const tokenAmount = sellAmount / currentPrice;

    const order: TradeOrder = {
      type: 'sell',
      tokenMint: position.tokenMint,
      chain: position.chain,
      amount: sellAmount,
      expectedPrice: currentPrice,
      slippageTolerance: 0.01,
      takeProfitTarget: target.target,
    };

    return this.executeSell({
      order,
      payer,
      payerKeypair,
      creator,
      tokenProgram,
      tokenAmount,
      useRelayer,
    });
  }
}

// Re-export TakeProfitTarget type
import type { TakeProfitTarget } from '../types';

