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
declare class HeliusMonitor {
  private ws;
  private activeCAs;
  private reconnectAttempts;
  private maxReconnectAttempts;
  private hasAuthError;
  private bot;
  /**
   * @param bot - Telegram bot instance for sending alerts and summaries.
   */
  constructor(bot: any);
  /**
   * Start the monitor:
   *   1. Load tracked assets from the database.
   *   2. Connect to the Helius WebSocket.
   *   3. Begin sending scheduled hourly summaries.
   */
  start(): Promise<void>;
  /**
   * Retrieve and register all active CA trackings from the database.
   * Clears previous cache to ensure full consistency.
   */
  private loadActiveCAs;
  /**
   * Establishes a persistent connection to the Helius WebSocket endpoint
   * and manages all related events (subscribe, reconnect, protocol errors).
   */
  private connect;
  /**
   * (Re)subscribe to price updates for all currently tracked CAs.
   * Safe no-op if WebSocket is not open.
   */
  private subscribeToAllTrackedCAs;
  /**
   * Central dispatch for WebSocket messages.
   * Easily extendable for new message types.
   * @param message - parsed incoming WS message object
   */
  private handleMessage;
  /**
   * Respond to real-time price updates for any tracked CA.
   * Stores the update and invokes strategy alerting logic.
   * @param params - { account, price, marketcap, timestamp }
   */
  private handlePriceUpdate;
  /**
   * Evaluates profit targets and stop-loss rules for a CA,
   * and sends notifications as appropriate. Ensures
   * duplicate alerts are never dispatched.
   *
   * @param ca - The CA being checked
   * @param currentPrice - The latest price
   * @param priceChange - The fractional change since call
   */
  private checkAlertsAndNotify;
  /**
   * Check for Ichimoku leading span crosses (immediate price alerts)
   */
  private checkIchimokuLeadingSpanCrosses;
  /**
   * Update candles array for Ichimoku analysis
   * Maintains a rolling window of recent 5-minute candles
   * Updates candles periodically from Birdeye API
   */
  private updateCandlesForIchimoku;
  /**
   * Check if current price is within 20% of any Ichimoku line
   */
  private isPriceNearIchimokuLines;
  /**
   * Check if price is within threshold percentage of a target value
   */
  private isWithinThreshold;
  /**
   * Request frequent price updates from Helius for monitored tokens
   */
  private requestFrequentPriceUpdates;
  /**
   * Start periodic update requests for all monitored tokens
   * This ensures we get constant price updates from Helius
   */
  private startPeriodicUpdateRequests;
  /**
   * Update candles from Birdeye API with proper OHLCV data
   */
  private updateCandlesFromBirdeye;
  /**
   * Check for Ichimoku signals and send alerts
   */
  private checkIchimokuSignals;
  /**
   * Send a general alert message
   */
  private sendAlert;
  /**
   * Send Ichimoku signal alert
   */
  private sendIchimokuAlert;
  /**
   * Attempt to reconnect with exponential backoff.
   * Will cap attempts by maxReconnectAttempts.
   */
  private handleReconnect;
  /**
   * Stop the monitor and clean up resources.
   */
  stop(): void;
  /**
   * Schedule hourly summaries. If production scheduling/cron needed, use a scheduler.
   */
  private scheduleHourlySummaries;
  /**
   * Build and send an hourly summary for each unique chatId,
   * reporting recent performance on all tracked tokens.
   */
  private sendHourlySummary;
  private fallbackPollingInterval;
  /**
   * Start fallback polling for Ichimoku alerts when WebSocket fails
   */
  private startFallbackPolling;
  /**
   * Stop fallback polling
   */
  private stopFallbackPolling;
  /**
   * Poll for Ichimoku alerts using REST API
   */
  private pollIchimokuAlerts;
  /**
   * Add a new CA tracking entry.
   * Will subscribe immediately if WebSocket is ready.
   * @param caData - New CA monitoring details
   */
  addCATracking(caData: any): Promise<void>;
  /**
   * Add a new CA tracking entry with pre-loaded historical candles for Ichimoku analysis.
   * @param caData - New CA monitoring details with historical candles
   */
  addCATrackingWithCandles(caData: any): Promise<void>;
}
export { HeliusMonitor };
//# sourceMappingURL=helius-monitor.d.ts.map
