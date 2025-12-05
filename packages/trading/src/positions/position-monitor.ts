/**
 * Position Monitor
 * 
 * Real-time position monitoring and auto-execution of stop-loss/take-profit
 */

import { EventEmitter } from 'events';
import { logger } from '@quantbot/utils';
import { PositionManager } from './position-manager';
import { TradeExecutor } from '../execution/trade-executor';
import type { Position, TakeProfitTarget } from '../types';

export interface PositionMonitorOptions {
  positionManager: PositionManager;
  tradeExecutor: TradeExecutor;
  checkInterval?: number; // Milliseconds between checks
}

/**
 * Position Monitor - monitors positions and executes stop-loss/take-profit
 */
export class PositionMonitor extends EventEmitter {
  private readonly positionManager: PositionManager;
  private readonly tradeExecutor: TradeExecutor;
  private readonly checkInterval: number;
  private intervalId: NodeJS.Timeout | null = null;
  private isMonitoring: boolean = false;

  // Price cache for positions
  private priceCache: Map<number, number> = new Map(); // positionId -> currentPrice

  constructor(options: PositionMonitorOptions) {
    super();
    this.positionManager = options.positionManager;
    this.tradeExecutor = options.tradeExecutor;
    this.checkInterval = options.checkInterval || 5000; // 5 seconds default
  }

  /**
   * Start monitoring positions
   */
  start(): void {
    if (this.isMonitoring) {
      logger.warn('PositionMonitor already running');
      return;
    }

    this.isMonitoring = true;
    this.intervalId = setInterval(() => this.checkPositions(), this.checkInterval);
    logger.info('PositionMonitor started', { checkInterval: this.checkInterval });
  }

  /**
   * Stop monitoring positions
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isMonitoring = false;
    logger.info('PositionMonitor stopped');
  }

  /**
   * Update price for a position
   */
  updatePrice(positionId: number, currentPrice: number): void {
    this.priceCache.set(positionId, currentPrice);
  }

  /**
   * Check all open positions and execute stop-loss/take-profit if needed
   */
  private async checkPositions(): Promise<void> {
    try {
      // Get all open positions (we'll need to get them by user, but for now we'll check all)
      // In a real implementation, we'd track which users have open positions
      // For now, we'll rely on price updates being provided via updatePrice()

      // Check each position in the cache
      for (const [positionId, currentPrice] of this.priceCache.entries()) {
        await this.checkPosition(positionId, currentPrice);
      }
    } catch (error) {
      logger.error('Error checking positions', error as Error);
    }
  }

  /**
   * Check a single position
   */
  private async checkPosition(positionId: number, currentPrice: number): Promise<void> {
    try {
      const position = await this.positionManager.getPosition(positionId);
      if (!position || position.status !== 'open') {
        // Remove from cache if position is closed
        this.priceCache.delete(positionId);
        return;
      }

      // Check stop-loss
      if (position.stopLossPrice && currentPrice <= position.stopLossPrice) {
        await this.executeStopLoss(position, currentPrice);
        return;
      }

      // Check take-profit targets
      if (position.takeProfitTargets) {
        for (const target of position.takeProfitTargets) {
          if (!target.executed && currentPrice >= position.entryPrice * target.target) {
            await this.executeTakeProfit(position, target, currentPrice);
          }
        }
      }
    } catch (error) {
      logger.error('Error checking position', error as Error, { positionId });
    }
  }

  /**
   * Execute stop-loss for a position
   */
  private async executeStopLoss(position: Position, currentPrice: number): Promise<void> {
    try {
      logger.info('Executing stop-loss', {
        positionId: position.id,
        entryPrice: position.entryPrice,
        stopLossPrice: position.stopLossPrice,
        currentPrice,
      });

      // Note: This requires wallet and keypair, which should be passed from the caller
      // For now, we'll emit an event and let the caller handle execution
      this.emit('stopLossTriggered', { position, currentPrice });

      // The actual execution should be handled by the caller with proper wallet/keypair
    } catch (error) {
      logger.error('Failed to execute stop-loss', error as Error, { positionId: position.id });
    }
  }

  /**
   * Execute take-profit for a position
   */
  private async executeTakeProfit(
    position: Position,
    target: TakeProfitTarget,
    currentPrice: number
  ): Promise<void> {
    try {
      logger.info('Executing take-profit', {
        positionId: position.id,
        target: target.target,
        percent: target.percent,
        currentPrice,
      });

      // Mark target as executed
      const updatedTargets = position.takeProfitTargets?.map((t) =>
        t.target === target.target ? { ...t, executed: true, executedAt: new Date() } : t
      );

      await this.positionManager.updatePosition(position.id, {
        takeProfitTargets: updatedTargets,
      });

      // Emit event for caller to handle execution
      this.emit('takeProfitTriggered', { position, target, currentPrice });
    } catch (error) {
      logger.error('Failed to execute take-profit', error as Error, {
        positionId: position.id,
        target: target.target,
      });
    }
  }
}

