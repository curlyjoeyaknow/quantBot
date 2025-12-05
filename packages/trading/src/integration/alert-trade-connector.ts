/**
 * Alert Trade Connector
 * 
 * Connects alert systems to trading execution
 */

import { EventEmitter } from 'events';
import { logger } from '@quantbot/utils';
import { TradingConfigService } from '../config/trading-config';
import { StrategyExecutor } from '../execution/strategy-executor';
import { TradeExecutor } from '../execution/trade-executor';
import { RiskManager } from '../safety/risk-manager';
import { PositionManager } from '../positions/position-manager';
import { WalletService } from '../wallet/wallet-service';
import type { TradingConfig, AlertTradeRules } from '../types';

export interface AlertTradeConnectorOptions {
  tradingConfigService: TradingConfigService;
  strategyExecutor: StrategyExecutor;
  tradeExecutor: TradeExecutor;
  riskManager: RiskManager;
  positionManager: PositionManager;
  walletService: WalletService;
}

/**
 * Alert Trade Connector - listens to alerts and triggers trades
 */
export class AlertTradeConnector extends EventEmitter {
  private readonly tradingConfigService: TradingConfigService;
  private readonly strategyExecutor: StrategyExecutor;
  private readonly tradeExecutor: TradeExecutor;
  private readonly riskManager: RiskManager;
  private readonly positionManager: PositionManager;
  private readonly walletService: WalletService;

  constructor(options: AlertTradeConnectorOptions) {
    super();
    this.tradingConfigService = options.tradingConfigService;
    this.strategyExecutor = options.strategyExecutor;
    this.tradeExecutor = options.tradeExecutor;
    this.riskManager = options.riskManager;
    this.positionManager = options.positionManager;
    this.walletService = options.walletService;
  }

  /**
   * Handle CA drop alert
   */
  async onCAAlert(alert: {
    userId: number;
    tokenMint: string;
    chain: string;
    callPrice: number;
    strategy: any[];
    stopLossConfig?: any;
    alertId?: number;
  }): Promise<void> {
    try {
      const config = await this.tradingConfigService.getConfig(alert.userId);
      if (!config || !config.enabled) {
        return;
      }

      if (!config.alertRules.caDropAlerts) {
        return;
      }

      if (!this.shouldExecuteTrade(alert, config)) {
        return;
      }

      // Execute trade
      await this.executeTradeFromAlert(alert, config);
    } catch (error) {
      logger.error('Failed to handle CA alert', error as Error, { alert });
    }
  }

  /**
   * Handle Ichimoku signal alert
   */
  async onIchimokuSignal(signal: {
    userId: number;
    tokenMint: string;
    chain: string;
    price: number;
    signalType: string;
    strategy?: any[];
    alertId?: number;
  }): Promise<void> {
    try {
      const config = await this.tradingConfigService.getConfig(signal.userId);
      if (!config || !config.enabled) {
        return;
      }

      if (!config.alertRules.ichimokuSignals) {
        return;
      }

      if (!this.shouldExecuteTrade(signal, config)) {
        return;
      }

      await this.executeTradeFromAlert(signal, config);
    } catch (error) {
      logger.error('Failed to handle Ichimoku signal', error as Error, { signal });
    }
  }

  /**
   * Handle live trade entry alert
   */
  async onLiveTradeEntry(entry: {
    userId: number;
    tokenMint: string;
    chain: string;
    entryPrice: number;
    strategy: any[];
    stopLossConfig?: any;
    alertId?: number;
  }): Promise<void> {
    try {
      const config = await this.tradingConfigService.getConfig(entry.userId);
      if (!config || !config.enabled) {
        return;
      }

      if (!config.alertRules.liveTradeEntry) {
        return;
      }

      if (!this.shouldExecuteTrade(entry, config)) {
        return;
      }

      await this.executeTradeFromAlert(entry, config);
    } catch (error) {
      logger.error('Failed to handle live trade entry', error as Error, { entry });
    }
  }

  /**
   * Check if trade should be executed based on alert and config
   */
  private shouldExecuteTrade(alert: any, config: TradingConfig): boolean {
    const rules = config.alertRules;

    // Check caller whitelist/blacklist if available
    if (alert.callerName) {
      if (rules.callerBlacklist?.includes(alert.callerName)) {
        return false;
      }
      if (rules.callerWhitelist && !rules.callerWhitelist.includes(alert.callerName)) {
        return false;
      }
    }

    // Check confidence if available
    if (alert.confidence && rules.minConfidence) {
      if (alert.confidence < rules.minConfidence) {
        return false;
      }
    }

    return true;
  }

  /**
   * Execute trade from alert
   */
  private async executeTradeFromAlert(alert: any, config: TradingConfig): Promise<void> {
    try {
      // Get user's active wallet
      const wallet = await this.walletService.getActiveWallet(alert.userId);
      if (!wallet) {
        logger.warn('No active wallet found for user', { userId: alert.userId });
        return;
      }

      // Get wallet balance
      const balance = await this.walletService.getBalance(wallet.id);
      if (balance < 0.01) {
        logger.warn('Insufficient wallet balance', { userId: alert.userId, balance });
        return;
      }

      // Generate trade orders from strategy
      const orders = this.strategyExecutor.executeStrategy({
        strategy: alert.strategy || [],
        entryPrice: alert.callPrice || alert.price || alert.entryPrice,
        walletBalance: balance,
        tokenMint: alert.tokenMint,
        chain: alert.chain,
        stopLossConfig: alert.stopLossConfig,
        maxPositionSize: config.maxPositionSize,
      });

      // Validate first order (buy)
      const buyOrder = orders.find((o) => o.type === 'buy');
      if (!buyOrder) {
        logger.warn('No buy order generated from strategy', { alert });
        return;
      }

      // Risk check
      const riskCheck = await this.riskManager.validateTrade(buyOrder, alert.userId, config);
      if (!riskCheck.valid) {
        logger.warn('Trade failed risk check', { userId: alert.userId, error: riskCheck.error });
        return;
      }

      // Execute buy order
      const keypair = await this.walletService.getKeypair(wallet.id);
      const result = await this.tradeExecutor.executeBuy({
        order: buyOrder,
        payer: keypair.publicKey,
        payerKeypair: keypair,
        creator: alert.creator, // Should be provided in alert
        useRelayer: !config.dryRun,
      });

      if (result.success && result.transactionSignature) {
        // Open position
        const position = await this.positionManager.openPosition({
          userId: alert.userId,
          walletId: wallet.id,
          tokenMint: alert.tokenMint,
          chain: alert.chain,
          entryPrice: buyOrder.expectedPrice,
          positionSize: buyOrder.amount,
          strategyId: alert.strategyId,
          alertId: alert.alertId,
          stopLossConfig: alert.stopLossConfig,
          takeProfitTargets: this.strategyExecutor.convertToTakeProfitTargets(alert.strategy || []),
        });

        this.emit('tradeExecuted', {
          userId: alert.userId,
          positionId: position.id,
          result,
        });
      }
    } catch (error) {
      logger.error('Failed to execute trade from alert', error as Error, { alert });
    }
  }
}

