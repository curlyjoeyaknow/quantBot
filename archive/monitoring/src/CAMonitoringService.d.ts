/**
 * CA Monitoring Service
 * =====================
 * Handles business logic for Custom Asset (CA) tracking, alerts, and notifications.
 * Separated from WebSocket management for better modularity and testability.
 */
import { EventEmitter } from 'events';
import type { Candle } from '@quantbot/core';
import type { IchimokuData } from '@quantbot/simulation';
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
export declare class CAMonitoringService extends EventEmitter {
  private activeCAs;
  private bot;
  constructor(bot: any);
  /**
   * Initialize the monitoring service
   */
  initialize(): Promise<void>;
  /**
   * Load active CAs from database
   */
  private loadActiveCAs;
  /**
   * Add a CA to monitoring
   */
  addCAMonitor(ca: CAMonitor): void;
  /**
   * Remove a CA from monitoring
   */
  removeCAMonitor(chain: string, mint: string): void;
  /**
   * Get all active CA monitors
   */
  getActiveCAs(): Map<string, CAMonitor>;
  /**
   * Get CA monitor by key
   */
  getCAMonitor(chain: string, mint: string): CAMonitor | undefined;
  /**
   * Handle price update event
   */
  handlePriceUpdate(event: PriceUpdateEvent): Promise<void>;
  /**
   * Check alerts and send notifications
   */
  private checkAlertsAndNotify;
  /**
   * Check Ichimoku leading span crosses
   */
  private checkIchimokuLeadingSpanCrosses;
  /**
   * Update candles for Ichimoku analysis
   */
  private updateCandlesForIchimoku;
  /**
   * Check Ichimoku signals
   */
  private checkIchimokuSignals;
  /**
   * Send alert to user
   */
  private sendAlert;
  /**
   * Get subscription requests for all active CAs
   */
  getSubscriptionRequests(): Array<{
    jsonrpc: string;
    id: string;
    method: string;
    params: any[];
  }>;
  /**
   * Get performance summary for all active CAs
   */
  getPerformanceSummary(): Promise<string>;
}
//# sourceMappingURL=CAMonitoringService.d.ts.map
