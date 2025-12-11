/**
 * Live Trade Alert Service
 * ========================
 * Monitors tokens from caller_alerts database (channels) and sends real-time
 * entry alerts to Telegram groups when entry conditions are triggered.
 *
 * Features:
 * - Efficient WebSocket streaming (Helius/Birdeye)
 * - Entry detection using strategy logic (Ichimoku, entry config)
 * - Comprehensive caching to minimize API calls
 * - Stores all price data and alerts
 * - Sends alerts to configured Telegram groups
 */
import { EventEmitter } from 'events';
import { CallerAlert } from '../storage/caller-database';
import type { Candle } from '../simulation/candles';
import type { EntryConfig } from '../simulation/config';
import { creditMonitor } from '../utils/credit-monitor';
export declare class LiveTradeAlertService extends EventEmitter {
    private ws;
    private activeMonitors;
    private priceCache;
    private reconnectAttempts;
    private maxReconnectAttempts;
    private updateInterval;
    private rpcPollInterval;
    private isRunning;
    private telegramBot;
    private enabledStrategies;
    private strategyUpdateInterval;
    constructor();
    /**
     * Initialize Telegram bot for sending alerts
     */
    private initializeTelegramBot;
    /**
     * Start the live trade alert service
     */
    start(): Promise<void>;
    /**
     * Stop the service
     */
    stop(): Promise<void>;
    /**
     * Load tokens from caller_alerts database
     */
    private loadTokensFromDatabase;
    /**
     * Connect to Shyft WebSocket for Solana tokens
     */
    private connectWebSocket;
    /**
     * Subscribe to Solana tokens via Shyft WebSocket
     */
    private subscribeToSolanaTokens;
    /**
     * Handle WebSocket messages from Shyft
     */
    private handleWebSocketMessage;
    /**
     * Reconnect WebSocket with exponential backoff
     */
    private reconnectWebSocket;
    /**
     * Start RPC polling for ETH/BSC tokens (1 minute interval)
     */
    private startRPCPolling;
    /**
     * Start periodic price updates (fallback if WebSocket fails for Solana)
     */
    private startPeriodicUpdates;
    /**
     * Batch update prices for multiple tokens
     */
    private updatePricesBatch;
    /**
     * Update token price and check for entry conditions
     */
    private updateTokenPrice;
    /**
     * Update candle data with new price
     */
    private updateCandles;
    /**
     * Recalculate indicators for all candles
     */
    private recalculateIndicators;
    /**
     * Load enabled strategies from database
     */
    private loadEnabledStrategies;
    /**
     * Check entry conditions using strategy logic
     */
    private checkEntryConditions;
    /**
     * Send entry alert to Telegram groups
     */
    private sendEntryAlert;
    /**
     * Format entry alert message for Telegram
     */
    private formatEntryAlertMessage;
    /**
     * Add a token to monitoring manually
     * Optionally pre-populate with historical candles
     */
    addToken(alert: CallerAlert, entryConfig?: EntryConfig, historicalCandles?: Candle[]): Promise<void>;
    /**
     * Fetch price from Birdeye API with caching
     */
    private fetchPriceFromBirdeye;
    /**
     * Get monitoring status
     */
    getStatus(): {
        isRunning: boolean;
        monitoredTokens: number;
        websocketConnected: boolean;
        alertGroups: number;
        solanaTokens: number;
        ethBscTokens: number;
        creditUsage: ReturnType<typeof creditMonitor.getReport>;
    };
}
export default LiveTradeAlertService;
//# sourceMappingURL=live-trade-alert-service.d.ts.map