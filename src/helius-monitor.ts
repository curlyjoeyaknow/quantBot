/**
 * HeliusMonitor
 * ============================================================================
 * Real-time monitor for Custom Assets (CAs) using the Helius WebSocket API.
 * Designed for consistency, maintainability, and seamless extensibility.
 *
 * Core Responsibilities:
 *   - Manage WebSocket connectivity and auto-reconnect.
 *   - Subscribe/unsubscribe to tracked CAs dynamically.
 *   - Persist price updates and event triggers.
 *   - Trigger profit/stop loss/strategy alerts for users.
 *   - Dispatch regular performance summaries to engaged users.
 * 
 * Each public API/method is clearly documented and organized for ease of upgrade.
 * ============================================================================
 */

import WebSocket from 'ws';
import axios from 'axios';
import { DateTime } from 'luxon';
import { 
  getActiveCATracking,
  savePriceUpdate,
  saveAlertSent,
  getRecentCAPerformance
} from './utils/database';
import { logger } from './utils/logger';
import type { Candle } from './simulation/candles';
import type { IchimokuData, IchimokuSignal } from './simulation/ichimoku';
import { simulateStrategy } from './simulation/engine';
import { 
  calculateIchimoku, 
  detectIchimokuSignals, 
  formatIchimokuData 
} from './simulation/ichimoku';

/* ============================================================================
 * Configuration
 * ============================================================================
 */
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '50c004c8-c6c4-4e1a-a85a-554942ca2368';
const HELIUS_WS_URL = `wss://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

/* ============================================================================
 * Types & Interfaces
 * ============================================================================
 */

/**
 * Represents an actively tracked Custom Asset (CA).
 */
interface CAMonitor {
  id: number;                 // Internal tracking ID
  mint: string;               // Asset mint address (unique identifier)
  chain: string;              // Chain name, e.g. 'solana'
  tokenName: string;          // Human friendly name
  tokenSymbol: string;        // Token symbol
  callPrice: number;          // Price at "call" time
  callMarketcap: number;      // Marketcap at strategy call
  callTimestamp: number;      // Timestamp when tracking started
  strategy: any[];            // Array of profit targets per-strategy
  stopLossConfig: any;        // Stop loss config
  chatId: number;             // Telegram chat/user/channel for alerts
  userId: number;             // Owner user id
  lastPrice?: number;         // Most recent price (undefined until first update)
  alertsSent: Set<string>;    // Alert keys already sent (to prevent duplicates)
  candles: Candle[];          // Recent candles for Ichimoku analysis (5m data)
  lastIchimoku?: IchimokuData; // Last calculated Ichimoku data
  ichimokuSignalsSent: Set<string>; // Ichimoku signals already sent
  ichimokuLeadingSpans?: {    // Ichimoku leading spans for price alerts
    senkouA: number;
    senkouB: number;
    cloudTop: number;
    cloudBottom: number;
  };
  lastCandleUpdate?: number;  // Timestamp of last candle update
  candleUpdateInterval?: number; // Interval for candle updates (ms)
  lastPriceRequest?: number;  // Last time we requested price updates from Helius
}

/* ============================================================================
 * HeliusMonitor Class
 * ============================================================================
 */
class HeliusMonitor {
  // --- Core State
  private ws: WebSocket | null = null;                  // Current WebSocket connection (null if idle)
  private activeCAs: Map<string, CAMonitor> = new Map();// `${chain}:${mint}` => CAMonitor
  private reconnectAttempts: number = 0;                // For reconnection backoff
  private maxReconnectAttempts: number = 5;             // Exponential backoff cap
  private hasAuthError: boolean = false;                // Track if we've had auth errors
  private bot: any;                                     // Telegram bot instance

  /**
   * @param bot - Telegram bot instance for sending alerts and summaries.
   */
  constructor(bot: any) {
    this.bot = bot;
  }

  /**
   * Start the monitor:
   *   1. Load tracked assets from the database.
   *   2. Connect to the Helius WebSocket.
   *   3. Begin sending scheduled hourly summaries.
   */
  public async start(): Promise<void> {
    logger.info('Starting Helius WebSocket monitoring...');
    await this.loadActiveCAs();
    this.connect();
    this.scheduleHourlySummaries();
    this.startPeriodicUpdateRequests();
  }

  /**
   * Retrieve and register all active CA trackings from the database.
   * Clears previous cache to ensure full consistency.
   */
  private async loadActiveCAs(): Promise<void> {
    try {
      // Don't auto-load any tokens - only monitor explicitly flagged tokens
      this.activeCAs.clear();
      logger.info('No auto-loaded CA tracking entries. Only manually flagged tokens will be monitored.');
    } catch (error) {
      logger.error('Error loading active CAs', error as Error);
    }
  }

  /* ==========================================================================
   * Connection & Subscription Management
   * ========================================================================== */

  /**
   * Establishes a persistent connection to the Helius WebSocket endpoint
   * and manages all related events (subscribe, reconnect, protocol errors).
   */
  private connect(): void {
    if (!HELIUS_API_KEY) {
      logger.error('HELIUS_API_KEY not set in environment.');
      return;
    }

    try {
      logger.info('Connecting to Helius WebSocket...');
      this.ws = new WebSocket(HELIUS_WS_URL);

    // On WebSocket open: subscribe to all tracked assets
    this.ws!.on('open', () => {
      logger.info('Connected to Helius WebSocket.');
      this.reconnectAttempts = 0;
      this.hasAuthError = false;
      this.subscribeToAllTrackedCAs();
    });

    // Parse and dispatch WebSocket messages
    this.ws!.on('message', (data: WebSocket.RawData) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (error) {
        logger.error('Error parsing WebSocket message', error as Error);
      }
    });

    // Auto-reconnect on connection loss
    this.ws!.on('close', () => {
      logger.warn('Helius WebSocket connection closed.');
      this.handleReconnect();
    });

    // Non-fatal protocol errors
    this.ws!.on('error', (error) => {
      logger.error('Helius WebSocket error', error as Error);
      // Don't crash the bot on WebSocket errors
      if (error.message && error.message.includes('401')) {
        logger.warn('Helius API key invalid - disabling real-time monitoring');
        logger.info('Starting fallback polling for Ichimoku alerts...');
        this.hasAuthError = true;
        this.startFallbackPolling();
        this.stop();
      }
    });
    } catch (error) {
      logger.error('Failed to create Helius WebSocket connection', error as Error);
      logger.info('Continuing without real-time CA monitoring...');
    }
  }

  /**
   * (Re)subscribe to price updates for all currently tracked CAs.
   * Safe no-op if WebSocket is not open.
   */
  private subscribeToAllTrackedCAs(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const subscriptions = Array.from(this.activeCAs.keys()).map(key => {
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

    subscriptions.forEach(sub => {
      this.ws!.send(JSON.stringify(sub));
    });

    logger.info('Subscribed to price updates', { assetCount: subscriptions.length });
  }

  /* ==========================================================================
   * WebSocket Message Handling
   * ========================================================================== */
  
  /**
   * Central dispatch for WebSocket messages.
   * Easily extendable for new message types.
   * @param message - parsed incoming WS message object
   */
  private async handleMessage(message: any): Promise<void> {
    switch (message.method) {
      case 'price-update':
        await this.handlePriceUpdate(message.params);
        break;
      // Easily add more handlers for other message types as needed
      default:
        break;
    }
  }

  /**
   * Respond to real-time price updates for any tracked CA.
   * Stores the update and invokes strategy alerting logic.
   * @param params - { account, price, marketcap, timestamp }
   */
  private async handlePriceUpdate(params: any): Promise<void> {
    const { account, price, marketcap, timestamp } = params;

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
      logger.error('Error saving price update', error as Error, { caId: ca.id });
    }

    // Check for Ichimoku leading span crosses (immediate price alerts)
    await this.checkIchimokuLeadingSpanCrosses(ca, currentPrice, timestamp);

    // Update candles periodically or add new candle for Ichimoku analysis
    await this.updateCandlesForIchimoku(ca, currentPrice, timestamp);

    // Check if any alerts/targets are triggered
    await this.checkAlertsAndNotify(ca, currentPrice, priceChange);

    // Check Ichimoku signals
    await this.checkIchimokuSignals(ca, currentPrice, timestamp);
  }

  /* ==========================================================================
   * Alerts & Notifications
   * ========================================================================== */

  /**
   * Evaluates profit targets and stop-loss rules for a CA,
   * and sends notifications as appropriate. Ensures
   * duplicate alerts are never dispatched.
   * 
   * @param ca - The CA being checked
   * @param currentPrice - The latest price
   * @param priceChange - The fractional change since call
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
            `🪙 ${ca.tokenName} (${ca.tokenSymbol})\n` +
            `📈 Price: $${currentPrice.toFixed(8)} (${(priceChange * 100).toFixed(1)}%)\n` +
            `💰 Target: ${target.target}x at $${targetPrice.toFixed(8)}\n` +
            `📊 Strategy: ${(target.percent * 100).toFixed(0)}% position`
        });
        ca.alertsSent.add(alertKey);
      }
    }

    // --- Stop-Loss Alerts ---
    // stopLossConfig.initial should be negative, e.g. -0.1 for 10% stop loss
    const stopLossPrice = ca.callPrice * (1 + ca.stopLossConfig.initial);
    const stopLossKey = 'stop_loss';

    if (currentPrice <= stopLossPrice && !ca.alertsSent.has(stopLossKey)) {
      alerts.push({
        type: 'stop_loss',
        message:
          `🛑 *STOP LOSS TRIGGERED!*\n\n` +
          `🪙 ${ca.tokenName} (${ca.tokenSymbol})\n` +
          `📉 Price: $${currentPrice.toFixed(8)} (${(priceChange * 100).toFixed(1)}%)\n` +
          `🛑 Stop: ${(ca.stopLossConfig.initial * 100).toFixed(0)}% at $${stopLossPrice.toFixed(8)}`
      });
      ca.alertsSent.add(stopLossKey);
    }

    // --- Send Any Alerts Triggered ---
    for (const alert of alerts) {
      try {
        await this.bot.telegram.sendMessage(
          ca.chatId,
          alert.message,
          { parse_mode: 'Markdown' }
        );
        await saveAlertSent(
          ca.id,
          alert.type,
          currentPrice,
          Math.floor(Date.now() / 1000)
        );
        logger.info('Sent alert', { alertType: alert.type, tokenName: ca.tokenName, tokenSymbol: ca.tokenSymbol });
      } catch (error) {
        logger.error('Error sending alert', error as Error, { caId: ca.id, alertType: alert.type });
      }
    }
  }

  /* ==========================================================================
   * Ichimoku Cloud Analysis
   * ========================================================================== */

  /**
   * Check for Ichimoku leading span crosses (immediate price alerts)
   */
  private async checkIchimokuLeadingSpanCrosses(ca: CAMonitor, currentPrice: number, timestamp: number): Promise<void> {
    if (!ca.ichimokuLeadingSpans) return;

    const { senkouA, senkouB, cloudTop, cloudBottom } = ca.ichimokuLeadingSpans;
    const lastPrice = ca.lastPrice || ca.callPrice;

    // Check for crosses of Senkou Span A
    if ((lastPrice <= senkouA && currentPrice > senkouA) || (lastPrice >= senkouA && currentPrice < senkouA)) {
      const direction = currentPrice > senkouA ? 'above' : 'below';
      const emoji = currentPrice > senkouA ? '🟢' : '🔴';
      
      const message = `${emoji} **Ichimoku Leading Span Cross!**\n\n` +
        `🪙 **${ca.tokenName}** (${ca.tokenSymbol})\n` +
        `📊 **Price crossed ${direction} Senkou Span A**\n` +
        `💰 **Price**: $${currentPrice.toFixed(8)}\n` +
        `📈 **Senkou Span A**: $${senkouA.toFixed(8)}\n\n` +
        `This indicates a potential trend change signal.`;

      await this.sendAlert(ca, message);
      
      // Save alert
      await saveAlertSent(ca.id, 'ichimoku_senkou_a_cross', currentPrice, timestamp);
    }

    // Check for crosses of Senkou Span B
    if ((lastPrice <= senkouB && currentPrice > senkouB) || (lastPrice >= senkouB && currentPrice < senkouB)) {
      const direction = currentPrice > senkouB ? 'above' : 'below';
      const emoji = currentPrice > senkouB ? '🟢' : '🔴';
      
      const message = `${emoji} **Ichimoku Leading Span Cross!**\n\n` +
        `🪙 **${ca.tokenName}** (${ca.tokenSymbol})\n` +
        `📊 **Price crossed ${direction} Senkou Span B**\n` +
        `💰 **Price**: $${currentPrice.toFixed(8)}\n` +
        `📈 **Senkou Span B**: $${senkouB.toFixed(8)}\n\n` +
        `This indicates a potential trend change signal.`;

      await this.sendAlert(ca, message);
      
      // Save alert
      await saveAlertSent(ca.id, 'ichimoku_senkou_b_cross', currentPrice, timestamp);
    }

    // Check for cloud cross (price crossing cloud boundaries)
    if ((lastPrice <= cloudBottom && currentPrice > cloudTop) || (lastPrice >= cloudTop && currentPrice < cloudBottom)) {
      const direction = currentPrice > cloudTop ? 'above' : 'below';
      const emoji = currentPrice > cloudTop ? '🟢' : '🔴';
      
      const message = `${emoji} **Ichimoku Cloud Cross!**\n\n` +
        `🪙 **${ca.tokenName}** (${ca.tokenSymbol})\n` +
        `📊 **Price crossed ${direction} Ichimoku Cloud**\n` +
        `💰 **Price**: $${currentPrice.toFixed(8)}\n` +
        `☁️ **Cloud**: $${cloudBottom.toFixed(8)} - $${cloudTop.toFixed(8)}\n\n` +
        `This is a strong trend change signal!`;

      await this.sendAlert(ca, message);
      
      // Save alert
      await saveAlertSent(ca.id, 'ichimoku_cloud_cross', currentPrice, timestamp);
    }
  }

  /**
   * Update candles array for Ichimoku analysis
   * Maintains a rolling window of recent 5-minute candles
   * Updates candles periodically from Birdeye API
   */
  private async updateCandlesForIchimoku(ca: CAMonitor, price: number, timestamp: number): Promise<void> {
    if (!ca.lastIchimoku) return;

    const now = Date.now();
    const lastUpdate = ca.lastCandleUpdate || 0;
    
    // Check if price is within 20% of any Ichimoku line for dynamic update frequency
    const ichimoku = ca.lastIchimoku;
    const isNearIchimokuLine = this.isPriceNearIchimokuLines(price, ichimoku);
    
    // Dynamic update interval based on proximity to Ichimoku lines
    let updateInterval: number;
    if (isNearIchimokuLine) {
      updateInterval = 5 * 60 * 1000; // 5 minutes when near Ichimoku lines
    } else {
      updateInterval = ca.candleUpdateInterval || (45 * 60 * 1000); // 45 minutes default
    }

    // Check if it's time for a candle update
    if (now - lastUpdate >= updateInterval) {
      try {
        await this.updateCandlesFromBirdeye(ca);
        ca.lastCandleUpdate = now;
        
        // Log the update reason
        if (isNearIchimokuLine) {
          logger.debug('Fast candle update', { tokenName: ca.tokenName, reason: 'near Ichimoku lines' });
        }
      } catch (error) {
        logger.error('Error updating candles from Birdeye', error as Error, { tokenName: ca.tokenName });
      }
    }

    // Request more frequent price updates from Helius for monitored tokens
    await this.requestFrequentPriceUpdates(ca);

    // For real-time monitoring, we don't create fake candles anymore
    // We rely on periodic updates from Birdeye API for proper OHLCV data
  }

  /**
   * Check if current price is within 20% of any Ichimoku line
   */
  private isPriceNearIchimokuLines(currentPrice: number, ichimoku: IchimokuData): boolean {
    const threshold = 0.20; // 20% threshold
    
    // Check proximity to Tenkan-sen
    if (this.isWithinThreshold(currentPrice, ichimoku.tenkan, threshold)) return true;
    
    // Check proximity to Kijun-sen
    if (this.isWithinThreshold(currentPrice, ichimoku.kijun, threshold)) return true;
    
    // Check proximity to Senkou Span A
    if (this.isWithinThreshold(currentPrice, ichimoku.senkouA, threshold)) return true;
    
    // Check proximity to Senkou Span B
    if (this.isWithinThreshold(currentPrice, ichimoku.senkouB, threshold)) return true;
    
    // Check proximity to Cloud boundaries
    if (this.isWithinThreshold(currentPrice, ichimoku.cloudTop, threshold)) return true;
    if (this.isWithinThreshold(currentPrice, ichimoku.cloudBottom, threshold)) return true;
    
    return false;
  }

  /**
   * Check if price is within threshold percentage of a target value
   */
  private isWithinThreshold(price: number, target: number, threshold: number): boolean {
    if (target === 0) return false; // Avoid division by zero
    
    const percentageDiff = Math.abs(price - target) / target;
    return percentageDiff <= threshold;
  }

  /**
   * Request frequent price updates from Helius for monitored tokens
   */
  private async requestFrequentPriceUpdates(ca: CAMonitor): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const now = Date.now();
    const lastRequest = ca.lastPriceRequest || 0;
    const requestInterval = 30 * 1000; // Request updates every 30 seconds

    // Only request if enough time has passed
    if (now - lastRequest >= requestInterval) {
      try {
        const subscription = {
          jsonrpc: '2.0',
          id: `${ca.chain}:${ca.mint}:price`,
          method: 'subscribe',
          params: [
            `price-updates-${ca.chain}`,
            {
              accounts: [ca.mint],
              // Request more frequent updates
              commitment: 'confirmed',
              // Add additional parameters for more frequent updates
              updateFrequency: 'high'
            }
          ]
        };

        this.ws.send(JSON.stringify(subscription));
        ca.lastPriceRequest = now;
        
        logger.debug('Requested frequent price updates', { tokenName: ca.tokenName });
      } catch (error) {
        logger.error('Error requesting frequent price updates', error as Error, { tokenName: ca.tokenName });
      }
    }
  }

  /**
   * Start periodic update requests for all monitored tokens
   * This ensures we get constant price updates from Helius
   */
  private startPeriodicUpdateRequests(): void {
    // Request updates every 60 seconds for all monitored tokens (reduced frequency)
    setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.activeCAs.size > 0) {
        // Only log every 10th request to reduce spam
        if (Math.random() < 0.1) {
          logger.debug('Requesting updates for monitored tokens', { count: this.activeCAs.size });
        }
        
        for (const [key, ca] of this.activeCAs) {
          try {
            const subscription = {
              jsonrpc: '2.0',
              id: `${key}:periodic`,
              method: 'subscribe',
              params: [
                `price-updates-${ca.chain}`,
                {
                  accounts: [ca.mint],
                  commitment: 'confirmed',
                  updateFrequency: 'high'
                }
              ]
            };

            this.ws.send(JSON.stringify(subscription));
          } catch (error) {
            logger.error('Error requesting periodic updates', error as Error, { tokenName: ca.tokenName });
          }
        }
      }
    }, 60 * 1000); // Every 60 seconds
  }

  /**
   * Update candles from Birdeye API with proper OHLCV data
   */
  private async updateCandlesFromBirdeye(ca: CAMonitor): Promise<void> {
    try {
      const { fetchHybridCandles } = await import('./simulation/candles');
      
      // Fetch last 52 candles (about 4.3 hours of 5m data)
      const endTime = DateTime.now().toUTC();
      const startTime = endTime.minus({ minutes: 260 }); // 52 * 5 minutes
      
      const newCandles = await fetchHybridCandles(ca.mint, startTime, endTime, ca.chain);
      
      if (newCandles.length >= 52) {
        ca.candles = newCandles;
        
        // Recalculate Ichimoku data with fresh candles
        const currentIndex = ca.candles.length - 1;
        const newIchimoku = calculateIchimoku(ca.candles, currentIndex);
        
        if (newIchimoku) {
          ca.lastIchimoku = newIchimoku;
          
          // Update leading spans for price alerts
          ca.ichimokuLeadingSpans = {
            senkouA: newIchimoku.senkouA,
            senkouB: newIchimoku.senkouB,
            cloudTop: newIchimoku.cloudTop,
            cloudBottom: newIchimoku.cloudBottom
          };
          
          logger.debug('Updated candles and recalculated Ichimoku', { tokenName: ca.tokenName, candleCount: newCandles.length });
        }
      }
    } catch (error) {
      logger.error('Error updating candles', error as Error, { tokenName: ca.tokenName });
    }
  }

  /**
   * Check for Ichimoku signals and send alerts
   */
  private async checkIchimokuSignals(ca: CAMonitor, currentPrice: number, timestamp: number): Promise<void> {
    // Need at least 52 candles for full Ichimoku calculation
    if (ca.candles.length < 52) {
      return;
    }

    try {
      // Calculate current Ichimoku data
      const currentIndex = ca.candles.length - 1;
      const currentIchimoku = calculateIchimoku(ca.candles, currentIndex);
      
      if (!currentIchimoku) {
        return;
      }

      // Detect signals if we have previous Ichimoku data
      if (ca.lastIchimoku) {
        const signals = detectIchimokuSignals(
          currentIchimoku,
          ca.lastIchimoku,
          currentPrice,
          timestamp
        );

        // Process each signal
        for (const signal of signals) {
          const signalKey = `${signal.type}_${signal.direction}_${Math.floor(timestamp / 300)}`; // 5-minute window
          
          if (!ca.ichimokuSignalsSent.has(signalKey)) {
            await this.sendIchimokuAlert(ca, signal, currentIchimoku, currentPrice);
            ca.ichimokuSignalsSent.add(signalKey);
          }
        }
      }

      // Update last Ichimoku data
      ca.lastIchimoku = currentIchimoku;

    } catch (error) {
      logger.error('Error in Ichimoku analysis', error as Error, { tokenName: ca.tokenName });
    }
  }

  /**
   * Send a general alert message
   */
  private async sendAlert(ca: CAMonitor, message: string): Promise<void> {
    try {
      await this.bot.telegram.sendMessage(ca.chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Error sending alert', error as Error, { tokenName: ca.tokenName });
    }
  }

  /**
   * Send Ichimoku signal alert
   */
  private async sendIchimokuAlert(
    ca: CAMonitor, 
    signal: IchimokuSignal, 
    ichimoku: IchimokuData, 
    currentPrice: number
  ): Promise<void> {
    const signalEmoji = signal.direction === 'bullish' ? '🟢' : '🔴';
    const strengthEmoji = signal.strength === 'strong' ? '🔥' : 
                          signal.strength === 'medium' ? '⚡' : '💡';

    const message = `${signalEmoji} **Ichimoku Signal Detected!**\n\n` +
      `🪙 **${ca.tokenName}** (${ca.tokenSymbol})\n` +
      `📊 **Signal**: ${signal.description}\n` +
      `💰 **Price**: $${currentPrice.toFixed(8)}\n` +
      `💪 **Strength**: ${strengthEmoji} ${signal.strength.toUpperCase()}\n\n` +
      formatIchimokuData(ichimoku, currentPrice);

    try {
      await this.bot.telegram.sendMessage(ca.chatId, message, { parse_mode: 'Markdown' });
      
      // Save alert to database
      await saveAlertSent(
        ca.id,
        `ichimoku_${signal.type}`,
        currentPrice,
        Math.floor(Date.now() / 1000)
      );
      
      logger.info('Sent Ichimoku alert', { signalType: signal.type, tokenName: ca.tokenName, tokenSymbol: ca.tokenSymbol });
    } catch (error) {
      logger.error('Error sending Ichimoku alert', error as Error, { tokenName: ca.tokenName });
    }
  }

  /* ==========================================================================
   * Reconnection Logic
   * ========================================================================== */

  /**
   * Attempt to reconnect with exponential backoff.
   * Will cap attempts by maxReconnectAttempts.
   */
  private handleReconnect(): void {
    if (this.hasAuthError) {
      logger.warn('Skipping reconnection due to authentication error');
      return;
    }
    
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached. Giving up.');
      return;
    }

    this.reconnectAttempts++;
    const delayMs = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    logger.warn('Reconnecting to WebSocket', { delayMs, attempt: this.reconnectAttempts });

    setTimeout(() => this.connect(), delayMs);
  }

  /**
   * Stop the monitor and clean up resources.
   */
  public stop(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.stopFallbackPolling();
    this.activeCAs.clear();
    this.reconnectAttempts = 0;
    logger.info('Helius monitor stopped.');
  }

  /* ==========================================================================
   * Summary & Reporting
   * ========================================================================== */

  /**
   * Schedule hourly summaries. If production scheduling/cron needed, use a scheduler.
   */
  private scheduleHourlySummaries(): void {
    setInterval(() => {
      this.sendHourlySummary().catch(e =>
        logger.error('Error in hourly summary', e as Error)
      );
    }, 60 * 60 * 1000); // Every hour
  }

  /**
   * Build and send an hourly summary for each unique chatId,
   * reporting recent performance on all tracked tokens.
   */
  private async sendHourlySummary(): Promise<void> {
    try {
      const performance = await getRecentCAPerformance(24);
      if (performance.length === 0) return;

      // Derive stats for each CA (priceChange, multiplier, etc.)
      const performanceData = performance.map(ca => ({
        ...ca,
        priceChange: (ca.currentPrice - ca.callPrice) / ca.callPrice,
        multiplier: ca.currentPrice / ca.callPrice
      }));

      // Group by chatId for reporting
      const chatIds = [...new Set(performanceData.map(ca => ca.chatId))];
      for (const chatId of chatIds) {
        const chatCAs = performanceData.filter(ca => ca.chatId === chatId);

        let summary = '📊 *Hourly CA Performance Summary*\n\n';
        summary += '🚀 *Top Performers:*\n';
        chatCAs.slice(0, 3).forEach(ca => {
          const emoji = ca.priceChange > 0 ? '🟢' : '🔴';
          summary += `${emoji} ${ca.tokenName}: ${(ca.priceChange * 100).toFixed(1)}% (${ca.multiplier.toFixed(2)}x)\n`;
        });

        summary += `\n📈 *Active Tracking:* ${chatCAs.length} tokens\n`;
        summary += `⏰ *Last Update:* ${DateTime.now().toFormat('HH:mm')}`;

        try {
          await this.bot.telegram.sendMessage(chatId, summary, { parse_mode: 'Markdown' });
        } catch (error) {
          logger.error('Error sending hourly summary to chat', error as Error, { chatId });
        }
      }
    } catch (error) {
      logger.error('Error generating hourly summary', error as Error);
    }
  }

  /* ==========================================================================
   * FALLBACK POLLING FOR ICHIMOKU ALERTS
   * ========================================================================== */

  private fallbackPollingInterval: NodeJS.Timeout | null = null;

  /**
   * Start fallback polling for Ichimoku alerts when WebSocket fails
   */
  private startFallbackPolling(): void {
    if (this.fallbackPollingInterval) return;

    logger.info('Starting fallback polling for Ichimoku alerts...');
    
    this.fallbackPollingInterval = setInterval(async () => {
      try {
        await this.pollIchimokuAlerts();
      } catch (error) {
        logger.error('Error in fallback polling', error as Error);
      }
    }, 30000); // Poll every 30 seconds
  }

  /**
   * Stop fallback polling
   */
  private stopFallbackPolling(): void {
    if (this.fallbackPollingInterval) {
      clearInterval(this.fallbackPollingInterval);
      this.fallbackPollingInterval = null;
      logger.info('Stopped fallback polling');
    }
  }

  /**
   * Poll for Ichimoku alerts using REST API
   */
  private async pollIchimokuAlerts(): Promise<void> {
    if (!HELIUS_API_KEY) return;

    for (const [key, ca] of this.activeCAs) {
      if (!ca.lastIchimoku) continue;

      try {
        // Get current price from Helius REST API
        const response = await axios.get(`https://api.helius.xyz/v0/token-metadata`, {
          params: {
            'api-key': HELIUS_API_KEY,
            mintAccounts: [ca.mint]
          }
        });

        if (response.data && response.data.length > 0) {
          const tokenData = response.data[0];
          const currentPrice = tokenData.price || 0;
          const timestamp = Date.now();

          if (currentPrice > 0) {
            // Check for Ichimoku signals
            await this.checkIchimokuLeadingSpanCrosses(ca, currentPrice, timestamp);
            ca.lastPrice = currentPrice;
          }
        }
      } catch (error) {
        logger.error('Error polling price', error as Error, { tokenName: ca.tokenName });
      }
    }
  }

  /* ==========================================================================
   * CA Management (External API)
   * ========================================================================== */

  /**
   * Add a new CA tracking entry.
   * Will subscribe immediately if WebSocket is ready.
   * @param caData - New CA monitoring details
   */
  public async addCATracking(caData: any): Promise<void> {
    const key = `${caData.chain}:${caData.mint}`;
    this.activeCAs.set(key, {
      ...caData,
      alertsSent: new Set(),
      candles: [],
      ichimokuSignalsSent: new Set()
    });

    // Subscribe to price updates for new CA, if possible
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const subscription = {
        jsonrpc: '2.0',
        id: key,
        method: 'subscribe',
        params: [
          `price-updates-${caData.chain}`,
          { accounts: [caData.mint] }
        ]
      };
      this.ws.send(JSON.stringify(subscription));
    }
  }

  /**
   * Add a new CA tracking entry with pre-loaded historical candles for Ichimoku analysis.
   * @param caData - New CA monitoring details with historical candles
   */
  public async addCATrackingWithCandles(caData: any): Promise<void> {
    const key = `${caData.chain}:${caData.mint}`;
    
    // Calculate initial Ichimoku data from historical candles
    let initialIchimoku: IchimokuData | null = null;
    if (caData.historicalCandles && caData.historicalCandles.length >= 52) {
      const currentIndex = caData.historicalCandles.length - 1;
      initialIchimoku = calculateIchimoku(caData.historicalCandles, currentIndex);
    }

    this.activeCAs.set(key, {
      ...caData,
      alertsSent: new Set(),
      candles: caData.historicalCandles || [],
      ichimokuSignalsSent: new Set(),
      lastIchimoku: initialIchimoku,
      ichimokuLeadingSpans: initialIchimoku ? {
        senkouA: initialIchimoku.senkouA,
        senkouB: initialIchimoku.senkouB,
        cloudTop: initialIchimoku.cloudTop,
        cloudBottom: initialIchimoku.cloudBottom
      } : null,
      lastCandleUpdate: Date.now(),
      candleUpdateInterval: 45 * 60 * 1000 // 45 minutes
    });

    // Subscribe to price updates for new CA, if possible
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const subscription = {
        jsonrpc: '2.0',
        id: key,
        method: 'subscribe',
        params: [
          `price-updates-${caData.chain}`,
          { accounts: [caData.mint] }
        ]
      };
      this.ws.send(JSON.stringify(subscription));
    }

    logger.info('Added CA tracking with historical candles', { candleCount: caData.historicalCandles?.length || 0, tokenName: caData.tokenName });
  }
}

export { HeliusMonitor };
