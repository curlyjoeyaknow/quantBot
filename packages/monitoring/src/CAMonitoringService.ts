/**
 * CA Monitoring Service
 * =====================
 * Handles business logic for Custom Asset (CA) tracking, alerts, and notifications.
 * Separated from WebSocket management for better modularity and testability.
 */

import { EventEmitter } from 'events';
import { DateTime } from 'luxon';
import { 
  getActiveCATracking,
  savePriceUpdate,
  saveAlertSent,
  getRecentCAPerformance
} from '@quantbot/utils';
import type { Candle } from '@quantbot/simulation/candles';
import type { IchimokuData, IchimokuSignal } from '@quantbot/simulation/ichimoku';
import { 
  calculateIchimoku, 
  detectIchimokuSignals, 
  formatIchimokuData 
} from '@quantbot/simulation/ichimoku';
import { eventBus, EventFactory } from '../events';
import { logger } from '@quantbot/utils';

export interface CAMonitor {
  id: number;
  mint: string;
  chain: string;
  tokenName: string;
  tokenSymbol: string;
  callPrice: number;
  callMarketcap: number;
  callTimestamp: number;
  strategy: any[];
  stopLossConfig: any;
  chatId: number;
  userId: number;
  lastPrice?: number;
  alertsSent: Set<string>;
  candles: Candle[];
  lastIchimoku?: IchimokuData;
  ichimokuSignalsSent: Set<string>;
  ichimokuLeadingSpans?: {
    senkouA: number;
    senkouB: number;
    cloudTop: number;
    cloudBottom: number;
  };
  lastCandleUpdate?: number;
  candleUpdateInterval?: number;
  lastPriceRequest?: number;
}

export interface PriceUpdateEvent {
  account: string;
  price: number;
  marketcap: number;
  timestamp: number;
}

export interface AlertEvent {
  type: 'profit_target' | 'stop_loss' | 'ichimoku_signal' | 'leading_span_cross';
  ca: CAMonitor;
  message: string;
  data?: any;
}

/**
 * CA Monitoring Service
 * Handles all business logic related to CA tracking and monitoring
 */
export class CAMonitoringService extends EventEmitter {
  private activeCAs: Map<string, CAMonitor> = new Map();
  private bot: any;

  constructor(bot: any) {
    super();
    this.bot = bot;
  }

  /**
   * Initialize the monitoring service
   */
  public async initialize(): Promise<void> {
    logger.info('Initializing CA Monitoring Service...');
    await this.loadActiveCAs();
    logger.info('CA Monitoring Service initialized', { activeCACount: this.activeCAs.size });
  }

  /**
   * Load active CAs from database
   */
  private async loadActiveCAs(): Promise<void> {
    try {
      this.activeCAs.clear();
      logger.info('No auto-loaded CA tracking entries. Only manually flagged tokens will be monitored.');
    } catch (error) {
      logger.error('Error loading active CAs', error as Error);
    }
  }

  /**
   * Add a CA to monitoring
   */
  public addCAMonitor(ca: CAMonitor): void {
    const key = `${ca.chain}:${ca.mint}`;
    this.activeCAs.set(key, ca);
    logger.info('Added CA monitor', { tokenName: ca.tokenName, tokenSymbol: ca.tokenSymbol, mint: ca.mint });
    
    // Emit CA monitor added event
    eventBus.publish(EventFactory.createSystemEvent(
      'ca.monitor.added',
      { 
        caId: ca.id,
        mint: ca.mint,
        chain: ca.chain,
        tokenName: ca.tokenName,
        tokenSymbol: ca.tokenSymbol
      },
      'CAMonitoringService'
    ));
    
    this.emit('caAdded', ca);
  }

  /**
   * Remove a CA from monitoring
   */
  public removeCAMonitor(chain: string, mint: string): void {
    const key = `${chain}:${mint}`;
    const ca = this.activeCAs.get(key);
    if (ca) {
      this.activeCAs.delete(key);
      logger.info('Removed CA monitor', { tokenName: ca.tokenName, tokenSymbol: ca.tokenSymbol, mint: ca.mint });
      this.emit('caRemoved', ca);
    }
  }

  /**
   * Get all active CA monitors
   */
  public getActiveCAs(): Map<string, CAMonitor> {
    return new Map(this.activeCAs);
  }

  /**
   * Get CA monitor by key
   */
  public getCAMonitor(chain: string, mint: string): CAMonitor | undefined {
    const key = `${chain}:${mint}`;
    return this.activeCAs.get(key);
  }

  /**
   * Handle price update event
   */
  public async handlePriceUpdate(event: PriceUpdateEvent): Promise<void> {
    const { account, price, marketcap, timestamp } = event;

    // Find the CA key whose mint matches the event account
    const caKey = Array.from(this.activeCAs.keys()).find(
      key => key.endsWith(account)
    );
    
    if (!caKey) return;

    const ca = this.activeCAs.get(caKey)!;
    const currentPrice = price;
    const priceChange = (currentPrice - ca.callPrice) / ca.callPrice;

    // Persist the update
    try {
      await savePriceUpdate(ca.id, currentPrice, marketcap, timestamp);
      ca.lastPrice = currentPrice;
    } catch (error) {
      logger.error('Error saving price update', error as Error, { mint: ca.mint });
    }

    // Check for Ichimoku leading span crosses (immediate price alerts)
    await this.checkIchimokuLeadingSpanCrosses(ca, currentPrice, timestamp);

    // Update candles periodically or add new candle for Ichimoku analysis
    await this.updateCandlesForIchimoku(ca, currentPrice, timestamp);

    // Check if any alerts/targets are triggered
    await this.checkAlertsAndNotify(ca, currentPrice, priceChange);

    // Check Ichimoku signals
    await this.checkIchimokuSignals(ca, currentPrice, timestamp);

    this.emit('priceUpdated', { ca, price: currentPrice, priceChange });
  }

  /**
   * Check alerts and send notifications
   */
  private async checkAlertsAndNotify(ca: CAMonitor, currentPrice: number, priceChange: number): Promise<void> {
    const alerts: Array<{ type: string; message: string }> = [];

    // --- Profit Target Alerts ---
    for (const target of ca.strategy) {
      const targetPrice = ca.callPrice * target.target;
      const alertKey = `profit_${target.target}x`;

      if (currentPrice >= targetPrice && !ca.alertsSent.has(alertKey)) {
        alerts.push({
          type: 'profit_target',
          message:
            `🎯 *${target.target}x TARGET HIT!*\n\n` +
            `🪙 **${ca.tokenName}** (${ca.tokenSymbol})\n` +
            `📈 Price: $${currentPrice.toFixed(6)}\n` +
            `💰 PNL: ${(priceChange * 100).toFixed(2)}%\n` +
            `📊 Target: ${target.percent * 100}% at ${target.target}x\n\n` +
            `⏰ ${DateTime.fromMillis(Date.now()).toFormat('yyyy-MM-dd HH:mm:ss')}`
        });
        ca.alertsSent.add(alertKey);
      }
    }

    // --- Stop Loss Alerts ---
    if (ca.stopLossConfig) {
      const stopLossPrice = ca.callPrice * (1 + ca.stopLossConfig.initial);
      const alertKey = 'stop_loss';

      if (currentPrice <= stopLossPrice && !ca.alertsSent.has(alertKey)) {
        alerts.push({
          type: 'stop_loss',
          message:
            `🛑 *STOP LOSS TRIGGERED!*\n\n` +
            `🪙 **${ca.tokenName}** (${ca.tokenSymbol})\n` +
            `📉 Price: $${currentPrice.toFixed(6)}\n` +
            `💰 PNL: ${(priceChange * 100).toFixed(2)}%\n` +
            `🛡️ Stop Loss: ${ca.stopLossConfig.initial * 100}%\n\n` +
            `⏰ ${DateTime.fromMillis(Date.now()).toFormat('yyyy-MM-dd HH:mm:ss')}`
        });
        ca.alertsSent.add(alertKey);
      }
    }

    // Send all alerts
    for (const alert of alerts) {
      await this.sendAlert(ca, alert.message);
      this.emit('alertSent', { type: alert.type, ca, message: alert.message });
    }
  }

  /**
   * Check Ichimoku leading span crosses
   */
  private async checkIchimokuLeadingSpanCrosses(ca: CAMonitor, currentPrice: number, timestamp: number): Promise<void> {
    if (!ca.ichimokuLeadingSpans) return;

    const { senkouA, senkouB, cloudTop, cloudBottom } = ca.ichimokuLeadingSpans;
    const alertKey = 'leading_span_cross';

    // Check if price crosses above or below the cloud
    if ((currentPrice > cloudTop || currentPrice < cloudBottom) && !ca.alertsSent.has(alertKey)) {
      const direction = currentPrice > cloudTop ? 'above' : 'below';
      const message = 
        `☁️ *ICHIMOKU CLOUD CROSS!*\n\n` +
        `🪙 **${ca.tokenName}** (${ca.tokenSymbol})\n` +
        `📈 Price: $${currentPrice.toFixed(6)}\n` +
        `☁️ Crossed ${direction} cloud\n` +
        `📊 Cloud Top: $${cloudTop.toFixed(6)}\n` +
        `📊 Cloud Bottom: $${cloudBottom.toFixed(6)}\n\n` +
        `⏰ ${DateTime.fromMillis(timestamp).toFormat('yyyy-MM-dd HH:mm:ss')}`;

      await this.sendAlert(ca, message);
      ca.alertsSent.add(alertKey);
      this.emit('alertSent', { type: 'leading_span_cross', ca, message });
    }
  }

  /**
   * Update candles for Ichimoku analysis
   */
  private async updateCandlesForIchimoku(ca: CAMonitor, currentPrice: number, timestamp: number): Promise<void> {
    const now = Date.now();
    const interval = ca.candleUpdateInterval || 300000; // 5 minutes default

    if (!ca.lastCandleUpdate || (now - ca.lastCandleUpdate) >= interval) {
      // Update candles logic would go here
      ca.lastCandleUpdate = now;
    }
  }

  /**
   * Check Ichimoku signals
   */
  private async checkIchimokuSignals(ca: CAMonitor, currentPrice: number, timestamp: number): Promise<void> {
    if (ca.candles.length < 52) return; // Need at least 52 candles for Ichimoku

    try {
      const currentIndex = ca.candles.length - 1;
      const ichimokuData = calculateIchimoku(ca.candles, currentIndex);
      
      if (!ichimokuData) return;
      
      const previousIndex = currentIndex - 1;
      const previousIchimoku = previousIndex >= 51 ? calculateIchimoku(ca.candles, previousIndex) : null;
      
      if (!previousIchimoku) return;
      
      const signals = detectIchimokuSignals(ichimokuData, previousIchimoku, currentPrice, timestamp);

      for (const signal of signals) {
        const alertKey = `ichimoku_${signal.type}`;
        
        if (!ca.ichimokuSignalsSent.has(alertKey)) {
          const message = formatIchimokuData(ichimokuData, currentPrice);
          await this.sendAlert(ca, message);
          ca.ichimokuSignalsSent.add(alertKey);
          this.emit('alertSent', { type: 'ichimoku_signal', ca, message, data: signal });
        }
      }

      ca.lastIchimoku = ichimokuData;
    } catch (error) {
      logger.error('Error checking Ichimoku signals', error as Error, { mint: ca.mint });
    }
  }

  /**
   * Send alert to user
   */
  private async sendAlert(ca: CAMonitor, message: string): Promise<void> {
    try {
      await this.bot.telegram.sendMessage(ca.chatId, message, { parse_mode: 'Markdown' });
      await saveAlertSent(ca.id, 'custom_alert', ca.lastPrice || 0, Date.now());
    } catch (error) {
      logger.error('Error sending alert', error as Error, { mint: ca.mint });
    }
  }

  /**
   * Get subscription requests for all active CAs
   */
  public getSubscriptionRequests(): Array<{
    jsonrpc: string;
    id: string;
    method: string;
    params: any[];
  }> {
    return Array.from(this.activeCAs.keys()).map(key => {
      const [chain, mint] = key.split(':');
      return {
        jsonrpc: '2.0',
        id: key,
        method: 'subscribe',
        params: [
          `price-updates-${chain}`,
          { accounts: [mint] }
        ]
      };
    });
  }

  /**
   * Get performance summary for all active CAs
   */
  public async getPerformanceSummary(): Promise<string> {
    const summaries: string[] = [];
    
    for (const [key, ca] of this.activeCAs) {
      if (ca.lastPrice) {
        const priceChange = (ca.lastPrice - ca.callPrice) / ca.callPrice;
        const chainEmoji = ca.chain === 'ethereum' ? '⟠' : ca.chain === 'bsc' ? '🟡' : ca.chain === 'base' ? '🔵' : '◎';
        
        summaries.push(
          `${chainEmoji} **${ca.tokenName}** (${ca.tokenSymbol})\n` +
          `📈 Price: $${ca.lastPrice.toFixed(6)} (${(priceChange * 100).toFixed(2)}%)\n` +
          `💰 PNL: ${priceChange >= 0 ? '📈' : '📉'} ${(priceChange * 100).toFixed(2)}%\n`
        );
      }
    }

    if (summaries.length === 0) {
      return '📊 **Performance Summary**\n\nNo active CA monitoring.';
    }

    return `📊 **Performance Summary**\n\n${summaries.join('\n')}`;
  }
}
