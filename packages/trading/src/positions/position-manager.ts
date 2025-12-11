/**
 * Position Manager
 * 
 * Tracks open positions in the database
 */

import { queryPostgres } from '@quantbot/data';
import { logger } from '@quantbot/utils';
import type { Position, PositionEvent, OpenPositionParams, TakeProfitTarget } from '../types';

export interface PositionManagerOptions {
  // No options needed - uses queryPostgres directly
}

/**
 * Position Manager - tracks positions in database
 */
export class PositionManager {
  constructor(options?: PositionManagerOptions) {
    // Uses queryPostgres directly
  }

  /**
   * Open a new position
   */
  async openPosition(params: OpenPositionParams): Promise<Position> {
    try {
      const query = `
        INSERT INTO positions (
          user_id, wallet_id, token_mint, chain, entry_price,
          position_size, remaining_size, status, strategy_id, alert_id,
          stop_loss_price, take_profit_targets_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
      `;

      const stopLossPrice = params.stopLossConfig
        ? params.entryPrice * (1 + params.stopLossConfig.initial)
        : null;

      const values = [
        params.userId,
        params.walletId,
        params.tokenMint,
        params.chain,
        params.entryPrice,
        params.positionSize,
        params.positionSize, // Initially, remaining = full position
        'open',
        params.strategyId || null,
        params.alertId || null,
        stopLossPrice,
        JSON.stringify(params.takeProfitTargets || []),
      ];

      const result = await queryPostgres(query, values);
      const position = this.mapRowToPosition(result.rows[0]);

      // Create entry event
      await this.addPositionEvent({
        positionId: position.id,
        eventType: 'entry',
        price: params.entryPrice,
        size: params.positionSize,
      });

      return position;
    } catch (error) {
      logger.error('Failed to open position', error as Error, { params });
      throw error;
    }
  }

  /**
   * Update a position
   */
  async updatePosition(
    positionId: number,
    updates: Partial<Position>
  ): Promise<void> {
    try {
      const updateFields: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (updates.remainingSize !== undefined) {
        updateFields.push(`remaining_size = $${paramIndex++}`);
        values.push(updates.remainingSize);
      }
      if (updates.status !== undefined) {
        updateFields.push(`status = $${paramIndex++}`);
        values.push(updates.status);
      }
      if (updates.stopLossPrice !== undefined) {
        updateFields.push(`stop_loss_price = $${paramIndex++}`);
        values.push(updates.stopLossPrice);
      }
      if (updates.takeProfitTargets !== undefined) {
        updateFields.push(`take_profit_targets_json = $${paramIndex++}`);
        values.push(JSON.stringify(updates.takeProfitTargets));
      }

      if (updateFields.length === 0) {
        return; // No updates
      }

      updateFields.push(`updated_at = NOW()`);
      values.push(positionId);

      const query = `
        UPDATE positions
        SET ${updateFields.join(', ')}
        WHERE id = $${paramIndex}
      `;

      await queryPostgres(query, values);
    } catch (error) {
      logger.error('Failed to update position', error as Error, { positionId, updates });
      throw error;
    }
  }

  /**
   * Close a position (fully or partially)
   */
  async closePosition(
    positionId: number,
    closePrice: number,
    signature: string,
    closeSize?: number // If not provided, closes entire position
  ): Promise<void> {
    try {
      const position = await this.getPosition(positionId);
      if (!position) {
        throw new Error(`Position ${positionId} not found`);
      }

      const sizeToClose = closeSize || position.remainingSize;
      const newRemainingSize = position.remainingSize - sizeToClose;
      const newStatus =
        newRemainingSize <= 0.0001 ? 'closed' : 'partial'; // Small threshold for rounding

      await this.updatePosition(positionId, {
        remainingSize: Math.max(0, newRemainingSize),
        status: newStatus,
      });

      // Add exit event
      await this.addPositionEvent({
        positionId,
        eventType: newStatus === 'closed' ? 'exit' : 'partial_close',
        price: closePrice,
        size: sizeToClose,
        transactionSignature: signature,
      });
    } catch (error) {
      logger.error('Failed to close position', error as Error, { positionId, closePrice });
      throw error;
    }
  }

  /**
   * Get a position by ID
   */
  async getPosition(positionId: number): Promise<Position | null> {
    try {
      const result = await queryPostgres(
        `SELECT * FROM positions WHERE id = $1`,
        [positionId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToPosition(result.rows[0]);
    } catch (error) {
      logger.error('Failed to get position', error as Error, { positionId });
      throw error;
    }
  }

  /**
   * Get all open positions for a user
   */
  async getOpenPositions(userId: number): Promise<Position[]> {
    try {
      const result = await queryPostgres(
        `SELECT * FROM positions WHERE user_id = $1 AND status = 'open' ORDER BY created_at DESC`,
        [userId]
      );

      return result.rows.map((row: any) => this.mapRowToPosition(row));
    } catch (error) {
      logger.error('Failed to get open positions', error as Error, { userId });
      throw error;
    }
  }

  /**
   * Get all positions for a user (open and closed)
   */
  async getAllPositions(userId: number, limit: number = 100): Promise<Position[]> {
    try {
      const result = await queryPostgres(
        `SELECT * FROM positions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [userId, limit]
      );

      return result.rows.map((row: any) => this.mapRowToPosition(row));
    } catch (error) {
      logger.error('Failed to get all positions', error as Error, { userId });
      throw error;
    }
  }

  /**
   * Calculate PNL for a position
   */
  calculatePnL(position: Position, currentPrice: number): number {
    const priceChange = currentPrice - position.entryPrice;
    const pnlPercent = priceChange / position.entryPrice;
    return position.remainingSize * pnlPercent;
  }

  /**
   * Add a position event
   */
  async addPositionEvent(event: Omit<PositionEvent, 'id' | 'timestamp'>): Promise<PositionEvent> {
    try {
      const query = `
        INSERT INTO position_events (
          position_id, event_type, price, size, transaction_signature
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `;

      const values = [
        event.positionId,
        event.eventType,
        event.price,
        event.size,
        event.transactionSignature || null,
      ];

      const result = await queryPostgres(query, values);
      return this.mapRowToEvent(result.rows[0]);
    } catch (error) {
      logger.error('Failed to add position event', error as Error, { event });
      throw error;
    }
  }

  /**
   * Get position events
   */
  async getPositionEvents(positionId: number): Promise<PositionEvent[]> {
    try {
      const result = await queryPostgres(
        `SELECT * FROM position_events WHERE position_id = $1 ORDER BY timestamp ASC`,
        [positionId]
      );

      return result.rows.map((row) => this.mapRowToEvent(row));
    } catch (error) {
      logger.error('Failed to get position events', error as Error, { positionId });
      throw error;
    }
  }

  /**
   * Map database row to Position
   */
  private mapRowToPosition(row: any): Position {
    return {
      id: parseInt(row.id),
      userId: parseInt(row.user_id),
      walletId: parseInt(row.wallet_id),
      tokenMint: row.token_mint,
      chain: row.chain,
      entryPrice: parseFloat(row.entry_price),
      entryTime: new Date(row.entry_time),
      positionSize: parseFloat(row.position_size),
      remainingSize: parseFloat(row.remaining_size),
      status: row.status,
      strategyId: row.strategy_id ? parseInt(row.strategy_id) : undefined,
      alertId: row.alert_id ? parseInt(row.alert_id) : undefined,
      stopLossPrice: row.stop_loss_price ? parseFloat(row.stop_loss_price) : undefined,
      takeProfitTargets: row.take_profit_targets_json
        ? JSON.parse(row.take_profit_targets_json)
        : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Map database row to PositionEvent
   */
  private mapRowToEvent(row: any): PositionEvent {
    return {
      id: parseInt(row.id),
      positionId: parseInt(row.position_id),
      eventType: row.event_type,
      price: parseFloat(row.price),
      size: parseFloat(row.size),
      timestamp: new Date(row.timestamp),
      transactionSignature: row.transaction_signature || undefined,
    };
  }
}

