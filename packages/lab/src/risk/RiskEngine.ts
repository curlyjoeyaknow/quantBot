/**
 * RiskEngine
 *
 * Risk management engine that enforces execution constraints.
 * Consumes signals from strategy, not candles directly.
 *
 * Supports:
 * - Fixed quote size
 * - ATR stops
 * - RR targets
 * - Trailing stops
 * - Max hold time
 * - Re-entry rules
 */

import type {
  RiskConfig,
  Position,
  RiskEvaluation,
  MarketData,
  StopLossConfig,
  TakeProfitConfig,
} from './types.js';
import { logger } from '@quantbot/infra/utils';

/**
 * RiskEngine
 */
export class RiskEngine {
  /**
   * Evaluate entry risk (determine position size)
   */
  evaluateEntry(
    config: RiskConfig,
    marketData: MarketData
  ): {
    shouldEnter: boolean;
    positionSize: number;
  } {
    // For now, always allow entry if strategy signals
    // Position size is determined by config
    const positionSize = config.positionSize.mode === 'fixed_quote' ? config.positionSize.quote : 0;

    if (positionSize <= 0) {
      return { shouldEnter: false, positionSize: 0 };
    }

    return { shouldEnter: true, positionSize };
  }

  /**
   * Initialize position with risk constraints
   */
  initializePosition(
    config: RiskConfig,
    tokenId: string,
    entryTs: number,
    entryPrice: number,
    positionSize: number,
    marketData: MarketData
  ): Position {
    const position: Position = {
      tokenId,
      entryTs,
      entryPrice,
      size: positionSize,
    };

    // Set stop loss price
    position.stopLossPrice = this.computeStopLossPrice(config.stopLoss, entryPrice, marketData);

    // Set take profit price
    position.takeProfitPrice = this.computeTakeProfitPrice(
      config.takeProfit,
      entryPrice,
      position.stopLossPrice,
      marketData
    );

    // Set max hold time
    if (config.maxHoldMinutes) {
      position.maxHoldTs = entryTs + config.maxHoldMinutes * 60;
    }

    return position;
  }

  /**
   * Evaluate exit risk (check stop loss, take profit, max hold)
   */
  evaluateExit(config: RiskConfig, position: Position, marketData: MarketData): RiskEvaluation {
    const { currentPrice, ts } = marketData;

    // Check max hold time
    if (position.maxHoldTs && ts >= position.maxHoldTs) {
      return {
        shouldExit: true,
        shouldEnter: false,
        exitReason: 'max_hold',
      };
    }

    // Check stop loss
    if (position.stopLossPrice && currentPrice <= position.stopLossPrice) {
      return {
        shouldExit: true,
        shouldEnter: false,
        exitReason: 'stop_loss',
      };
    }

    // Check take profit
    if (position.takeProfitPrice && currentPrice >= position.takeProfitPrice) {
      return {
        shouldExit: true,
        shouldEnter: false,
        exitReason: 'take_profit',
      };
    }

    // Update trailing stop if configured
    if (config.stopLoss.mode === 'trailing_percent') {
      const newStopLossPrice = this.updateTrailingStop(config.stopLoss, position, marketData);
      if (newStopLossPrice && newStopLossPrice > (position.stopLossPrice ?? 0)) {
        position.stopLossPrice = newStopLossPrice;
        // Check if price hit new trailing stop
        if (currentPrice <= newStopLossPrice) {
          return {
            shouldExit: true,
            shouldEnter: false,
            exitReason: 'trailing_stop',
            newStopLossPrice,
          };
        }
        return {
          shouldExit: false,
          shouldEnter: false,
          newStopLossPrice,
        };
      }
    }

    return {
      shouldExit: false,
      shouldEnter: false,
    };
  }

  /**
   * Compute stop loss price
   */
  private computeStopLossPrice(
    stopLoss: StopLossConfig,
    entryPrice: number,
    marketData: MarketData
  ): number | undefined {
    switch (stopLoss.mode) {
      case 'fixed_percent':
        return entryPrice * (1 + stopLoss.percent); // percent is negative (e.g., -0.05)
      case 'trailing_percent':
        // Initial trailing stop starts at fixed percent
        return entryPrice * (1 + stopLoss.percent);
      case 'atr_multiple':
        if (!marketData.atr) {
          logger.warn('ATR not available for stop loss calculation', { stopLoss });
          return undefined;
        }
        return entryPrice - marketData.atr * stopLoss.multiple;
      default:
        return undefined;
    }
  }

  /**
   * Compute take profit price
   */
  private computeTakeProfitPrice(
    takeProfit: TakeProfitConfig,
    entryPrice: number,
    stopLossPrice: number | undefined,
    marketData: MarketData
  ): number | undefined {
    switch (takeProfit.mode) {
      case 'fixed_percent':
        return entryPrice * (1 + takeProfit.percent); // percent is positive (e.g., 0.10)
      case 'rr_multiple':
        if (!stopLossPrice) {
          logger.warn('Stop loss price required for RR multiple take profit', { takeProfit });
          return undefined;
        }
        const risk = entryPrice - stopLossPrice;
        return entryPrice + risk * takeProfit.rr;
      case 'none':
        return undefined;
      default:
        return undefined;
    }
  }

  /**
   * Update trailing stop
   */
  private updateTrailingStop(
    stopLoss: StopLossConfig,
    position: Position,
    marketData: MarketData
  ): number | undefined {
    if (stopLoss.mode !== 'trailing_percent') {
      return undefined;
    }

    const { currentPrice } = marketData;
    const currentStop = position.stopLossPrice ?? position.entryPrice * (1 + stopLoss.percent);

    // Trailing stop only moves up, never down
    const newStop = currentPrice * (1 + stopLoss.percent);
    if (newStop > currentStop) {
      return newStop;
    }

    return currentStop;
  }

  /**
   * Check if re-entry is allowed
   */
  canReenter(config: RiskConfig, previousExitTs: number, currentTs: number): boolean {
    if (!config.allowReentry) {
      return false;
    }
    // For now, allow re-entry immediately if configured
    // Could add cooldown period here
    return true;
  }
}
