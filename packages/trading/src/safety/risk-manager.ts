/**
 * Risk Manager
 * 
 * Validates trades against risk limits and safety rules
 */

import { queryPostgres } from '@quantbot/storage';
import { logger } from '@quantbot/utils';
import { PositionManager } from '../positions/position-manager';
import { TradingConfigService } from '../config/trading-config';
import type { TradeOrder, TradingConfig } from '../types';

export interface RiskManagerOptions {
  positionManager: PositionManager;
  tradingConfigService: TradingConfigService;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Risk Manager - validates trades against risk limits
 */
export class RiskManager {
  private readonly positionManager: PositionManager;
  private readonly tradingConfigService: TradingConfigService;

  constructor(options: RiskManagerOptions) {
    this.positionManager = options.positionManager;
    this.tradingConfigService = options.tradingConfigService;
  }

  /**
   * Validate a trade order
   */
  async validateTrade(
    trade: TradeOrder,
    userId: number,
    userConfig?: TradingConfig
  ): Promise<ValidationResult> {
    const config = userConfig || (await this.tradingConfigService.getConfig(userId));
    if (!config) {
      return { valid: false, error: 'Trading not configured for user' };
    }

    if (!config.enabled) {
      return { valid: false, error: 'Trading is disabled for user' };
    }

    // Check position size limits
    if (trade.type === 'buy') {
      const positionLimitCheck = await this.checkPositionLimits(userId, trade.amount, config);
      if (!positionLimitCheck.valid) {
        return positionLimitCheck;
      }
    }

    // Check daily loss limit
    const dailyLossCheck = await this.checkDailyLoss(userId, config);
    if (!dailyLossCheck.valid) {
      return dailyLossCheck;
    }

    // Validate slippage
    if (trade.slippageTolerance > config.slippageTolerance) {
      return {
        valid: false,
        error: `Slippage tolerance ${trade.slippageTolerance} exceeds configured limit ${config.slippageTolerance}`,
      };
    }

    return { valid: true };
  }

  /**
   * Check position size limits
   */
  async checkPositionLimits(
    userId: number,
    newPositionSize: number,
    config: TradingConfig
  ): Promise<ValidationResult> {
    // Check max position size
    if (newPositionSize > config.maxPositionSize) {
      return {
        valid: false,
        error: `Position size ${newPositionSize} exceeds maximum ${config.maxPositionSize} SOL`,
      };
    }

    // Check total exposure
    const openPositions = await this.positionManager.getOpenPositions(userId);
    const totalExposure = openPositions.reduce(
      (sum, pos) => sum + pos.remainingSize,
      0
    );

    if (totalExposure + newPositionSize > config.maxTotalExposure) {
      return {
        valid: false,
        error: `Total exposure ${totalExposure + newPositionSize} would exceed maximum ${config.maxTotalExposure} SOL`,
      };
    }

    return { valid: true };
  }

  /**
   * Check daily loss limit
   */
  async checkDailyLoss(userId: number, config: TradingConfig): Promise<ValidationResult> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const result = await queryPostgres(
        `SELECT COALESCE(SUM(size), 0) as total_loss
         FROM trades
         WHERE user_id = $1
           AND type = 'sell'
           AND status = 'confirmed'
           AND timestamp >= $2
           AND price < (
             SELECT entry_price
             FROM positions
             WHERE positions.id = trades.position_id
           )`,
        [userId, today]
      );

      const totalLoss = parseFloat(result.rows[0]?.total_loss || '0');

      if (totalLoss >= config.dailyLossLimit) {
        return {
          valid: false,
          error: `Daily loss limit ${config.dailyLossLimit} SOL reached (current: ${totalLoss} SOL)`,
        };
      }

      return { valid: true };
    } catch (error) {
      logger.error('Failed to check daily loss', error as Error, { userId });
      return { valid: false, error: 'Failed to check daily loss limit' };
    }
  }

  /**
   * Validate slippage
   */
  validateSlippage(
    expectedPrice: number,
    actualPrice: number,
    tolerance: number
  ): boolean {
    const slippage = Math.abs(actualPrice - expectedPrice) / expectedPrice;
    return slippage <= tolerance;
  }
}

