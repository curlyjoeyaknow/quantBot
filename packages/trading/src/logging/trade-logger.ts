/**
 * Trade Logger
 * 
 * Comprehensive trade logging and Telegram notifications
 */

import { queryPostgres } from '@quantbot/storage';
import { logger } from '@quantbot/utils';
import type { Trade, TradeResult } from '../types';

export interface TradeLoggerOptions {
  telegramBot?: any; // Telegraf bot instance (optional)
}

/**
 * Trade Logger - logs trades and sends notifications
 */
export class TradeLogger {
  private readonly telegramBot?: any;

  constructor(options?: TradeLoggerOptions) {
    this.telegramBot = options?.telegramBot;
  }

  /**
   * Log a trade
   */
  async logTrade(
    userId: number,
    trade: Omit<Trade, 'id' | 'timestamp' | 'created_at'>
  ): Promise<Trade> {
    try {
      const query = `
        INSERT INTO trades (
          user_id, position_id, type, token_mint, chain,
          price, size, slippage, transaction_signature, status, error_message
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `;

      const values = [
        userId,
        trade.positionId || null,
        trade.type,
        trade.tokenMint,
        trade.chain,
        trade.price,
        trade.size,
        trade.slippage || null,
        trade.transactionSignature || null,
        trade.status,
        trade.errorMessage || null,
      ];

      const result = await queryPostgres(query, values);
      const loggedTrade = this.mapRowToTrade(result.rows[0]);

      // Send notification if trade was successful
      if (trade.status === 'confirmed' && this.telegramBot) {
        await this.sendTradeNotification(userId, loggedTrade);
      }

      return loggedTrade;
    } catch (error) {
      logger.error('Failed to log trade', error as Error, { userId, trade });
      throw error;
    }
  }

  /**
   * Log trade result
   */
  async logTradeResult(
    userId: number,
    order: { type: 'buy' | 'sell'; tokenMint: string; chain: string; amount: number; expectedPrice: number },
    result: TradeResult,
    positionId?: number
  ): Promise<Trade> {
    const trade: Omit<Trade, 'id' | 'timestamp' | 'created_at'> = {
      userId,
      positionId,
      type: order.type,
      tokenMint: order.tokenMint,
      chain: order.chain,
      price: result.executedPrice || order.expectedPrice,
      size: result.executedAmount || order.amount,
      slippage: result.slippage,
      transactionSignature: result.transactionSignature,
      status: result.success ? 'confirmed' : 'failed',
      errorMessage: result.error,
    };

    return this.logTrade(userId, trade);
  }

  /**
   * Get trade history for a user
   */
  async getTradeHistory(userId: number, limit: number = 100): Promise<Trade[]> {
    try {
      const result = await queryPostgres(
        `SELECT * FROM trades WHERE user_id = $1 ORDER BY timestamp DESC LIMIT $2`,
        [userId, limit]
      );

      return result.rows.map((row) => this.mapRowToTrade(row));
    } catch (error) {
      logger.error('Failed to get trade history', error as Error, { userId });
      throw error;
    }
  }

  /**
   * Send Telegram notification for a trade
   */
  private async sendTradeNotification(userId: number, trade: Trade): Promise<void> {
    if (!this.telegramBot) {
      return;
    }

    try {
      const emoji = trade.type === 'buy' ? '🟢' : '🔴';
      const typeText = trade.type === 'buy' ? 'BUY' : 'SELL';
      const message = `
${emoji} **${typeText} Executed**

Token: \`${trade.tokenMint.substring(0, 8)}...\`
Price: ${trade.price.toFixed(8)} SOL
Size: ${trade.size.toFixed(4)} SOL
${trade.slippage ? `Slippage: ${(trade.slippage * 100).toFixed(2)}%` : ''}
${trade.transactionSignature ? `[View on Solscan](https://solscan.io/tx/${trade.transactionSignature})` : ''}
      `.trim();

      await this.telegramBot.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.warn('Failed to send trade notification', error as Error, { userId, tradeId: trade.id });
    }
  }

  /**
   * Map database row to Trade
   */
  private mapRowToTrade(row: Record<string, any>): Trade {
    return {
      id: parseInt(row.id),
      userId: parseInt(row.user_id),
      positionId: row.position_id ? parseInt(row.position_id) : undefined,
      type: row.type,
      tokenMint: row.token_mint,
      chain: row.chain,
      price: parseFloat(row.price),
      size: parseFloat(row.size),
      slippage: row.slippage ? parseFloat(row.slippage) : undefined,
      transactionSignature: row.transaction_signature || undefined,
      status: row.status,
      errorMessage: row.error_message || undefined,
      timestamp: new Date(row.timestamp),
    };
  }
}

