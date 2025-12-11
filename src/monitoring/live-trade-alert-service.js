"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LiveTradeAlertService = void 0;
const WS = __importStar(require("ws"));
const events_1 = require("events");
const caller_database_1 = require("../storage/caller-database");
const logger_1 = require("../utils/logger");
const ichimoku_1 = require("../simulation/ichimoku");
const indicators_1 = require("../simulation/indicators");
const live_trade_database_1 = require("../utils/live-trade-database");
const live_trade_strategies_1 = require("../utils/live-trade-strategies");
const monitored_tokens_db_1 = require("../utils/monitored-tokens-db");
const credit_monitor_1 = require("../utils/credit-monitor");
const axios_1 = __importDefault(require("axios"));
/* ============================================================================
 * Configuration
 * ============================================================================
 */
const SHYFT_API_KEY = process.env.SHYFT_API_KEY || '';
const SHYFT_X_TOKEN = process.env.SHYFT_X_TOKEN || '';
const SHYFT_WS_URL = process.env.SHYFT_WS_URL || 'wss://api.shyft.to/v1/stream';
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || '';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ALERT_GROUP_IDS = process.env.LIVE_TRADE_ALERT_GROUP_IDS?.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id)) || [];
// RPC polling interval for ETH/BSC (1 minute)
const RPC_POLL_INTERVAL_MS = 60 * 1000; // 1 minute
// Entry configuration defaults
const DEFAULT_ENTRY_CONFIG = {
    initialEntry: -0.1, // Wait for 10% drop from alert price
    trailingEntry: 0.05, // 5% rebound from low
    maxWaitTime: 60, // 60 minutes max wait
};
// Monitoring window - only monitor tokens from last N days
const MONITOR_WINDOW_DAYS = 7;
const CANDLE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const PRICE_CACHE_TTL_MS = 30 * 1000; // 30 seconds
const MIN_CANDLES_FOR_ENTRY = 52; // Need 52 candles for Ichimoku
/* ============================================================================
 * Live Trade Alert Service
 * ============================================================================
 */
class LiveTradeAlertService extends events_1.EventEmitter {
    constructor() {
        super();
        this.ws = null;
        this.activeMonitors = new Map();
        this.priceCache = new Map();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.updateInterval = null;
        this.rpcPollInterval = null; // For ETH/BSC tokens
        this.isRunning = false;
        this.telegramBot = null;
        this.enabledStrategies = new Set();
        this.strategyUpdateInterval = null;
        this.initializeTelegramBot();
    }
    /**
     * Initialize Telegram bot for sending alerts
     */
    initializeTelegramBot() {
        if (!TELEGRAM_BOT_TOKEN) {
            logger_1.logger.warn('TELEGRAM_BOT_TOKEN not set - alerts will not be sent to Telegram');
            return;
        }
        try {
            const { Telegraf } = require('telegraf');
            this.telegramBot = new Telegraf(TELEGRAM_BOT_TOKEN);
            logger_1.logger.info('Telegram bot initialized for live trade alerts');
        }
        catch (error) {
            logger_1.logger.error('Failed to initialize Telegram bot', error);
        }
    }
    /**
     * Start the live trade alert service
     */
    async start() {
        if (this.isRunning) {
            logger_1.logger.warn('Live trade alert service already running');
            return;
        }
        logger_1.logger.info('Starting Live Trade Alert Service...');
        this.isRunning = true;
        // Load tokens from caller_alerts database
        await this.loadTokensFromDatabase();
        // Connect to WebSocket for Solana tokens (Shyft)
        await this.connectWebSocket();
        // Start RPC polling for ETH/BSC tokens
        this.startRPCPolling();
        // Start periodic price updates (fallback)
        this.startPeriodicUpdates();
        logger_1.logger.info('Live Trade Alert Service started', {
            monitoredTokens: this.activeMonitors.size,
            alertGroups: ALERT_GROUP_IDS.length,
        });
    }
    /**
     * Stop the service
     */
    async stop() {
        logger_1.logger.info('Stopping Live Trade Alert Service...');
        this.isRunning = false;
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        if (this.strategyUpdateInterval) {
            clearInterval(this.strategyUpdateInterval);
            this.strategyUpdateInterval = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.activeMonitors.clear();
        this.priceCache.clear();
        logger_1.logger.info('Live Trade Alert Service stopped');
    }
    /**
     * Load tokens from caller_alerts database
     */
    async loadTokensFromDatabase() {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - MONITOR_WINDOW_DAYS);
            // Get recent alerts from database
            const alerts = await caller_database_1.callerDatabase.getCallerAlertsInRange('', // All callers
            cutoffDate, new Date());
            logger_1.logger.info('Loading tokens from database', { totalAlerts: alerts.length });
            for (const alert of alerts) {
                // Skip if already monitoring
                const key = `${alert.chain}:${alert.tokenAddress}`.toLowerCase();
                if (this.activeMonitors.has(key)) {
                    continue;
                }
                // Only monitor if we have alert price
                if (!alert.priceAtAlert || alert.priceAtAlert <= 0) {
                    continue;
                }
                // Create monitor
                const monitor = {
                    alertId: alert.id || 0,
                    tokenAddress: alert.tokenAddress,
                    tokenSymbol: alert.tokenSymbol || alert.tokenAddress.slice(0, 8),
                    chain: alert.chain,
                    callerName: alert.callerName,
                    alertTime: alert.alertTimestamp,
                    alertPrice: alert.priceAtAlert,
                    candles: [],
                    indicatorHistory: [],
                    entrySignalSent: false,
                    inPosition: false,
                    initialEntryTriggered: false,
                    trailingEntryTriggered: false,
                    entryConfig: DEFAULT_ENTRY_CONFIG,
                };
                this.activeMonitors.set(key, monitor);
                logger_1.logger.debug('Added token to monitoring', {
                    tokenSymbol: monitor.tokenSymbol,
                    callerName: monitor.callerName,
                });
            }
            logger_1.logger.info('Loaded tokens for monitoring', { count: this.activeMonitors.size });
        }
        catch (error) {
            logger_1.logger.error('Failed to load tokens from database', error);
            throw error;
        }
    }
    /**
     * Connect to Shyft WebSocket for Solana tokens
     */
    async connectWebSocket() {
        // Only connect if we have Solana tokens to monitor
        const solanaTokens = Array.from(this.activeMonitors.values()).filter((m) => m.chain === 'solana');
        if (solanaTokens.length === 0) {
            logger_1.logger.debug('No Solana tokens to monitor, skipping WebSocket connection');
            return;
        }
        if (!SHYFT_API_KEY && !SHYFT_X_TOKEN) {
            logger_1.logger.warn('SHYFT_API_KEY or SHYFT_X_TOKEN not set - using polling fallback for Solana');
            return;
        }
        try {
            logger_1.logger.info('Connecting to Shyft WebSocket for Solana tokens...');
            this.ws = new WS.WebSocket(SHYFT_WS_URL);
            if (this.ws) {
                this.ws.on('open', () => {
                    logger_1.logger.info('Connected to Shyft WebSocket');
                    this.reconnectAttempts = 0;
                    // Authenticate with Shyft
                    const authToken = SHYFT_X_TOKEN || SHYFT_API_KEY;
                    const authMessage = {
                        jsonrpc: '2.0',
                        id: 1,
                        method: 'auth',
                        params: [authToken],
                    };
                    this.ws.send(JSON.stringify(authMessage));
                    // Subscribe to Solana tokens after authentication
                    setTimeout(() => {
                        this.subscribeToSolanaTokens();
                    }, 1000); // Wait a bit for auth to complete
                });
                this.ws.on('message', (data) => {
                    try {
                        const message = JSON.parse(data.toString());
                        this.handleWebSocketMessage(message);
                    }
                    catch (error) {
                        logger_1.logger.error('Error parsing WebSocket message', error);
                    }
                });
                this.ws.on('close', () => {
                    logger_1.logger.warn('Shyft WebSocket connection closed');
                    this.reconnectWebSocket();
                });
                this.ws.on('error', (error) => {
                    logger_1.logger.error('Shyft WebSocket error', error);
                    this.reconnectWebSocket();
                });
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to connect to Shyft WebSocket', error);
            // Fallback to polling for Solana tokens
        }
    }
    /**
     * Subscribe to Solana tokens via Shyft WebSocket
     */
    subscribeToSolanaTokens() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return;
        }
        const solanaTokens = Array.from(this.activeMonitors.values())
            .filter((m) => m.chain === 'solana')
            .map((m) => m.tokenAddress);
        if (solanaTokens.length === 0) {
            return;
        }
        // Shyft WebSocket subscription format for token price updates
        solanaTokens.forEach((tokenAddress, index) => {
            const subscription = {
                jsonrpc: '2.0',
                id: index + 1,
                method: 'subscribe',
                params: {
                    channel: 'token_price',
                    token: tokenAddress,
                },
            };
            this.ws.send(JSON.stringify(subscription));
            // Record credit usage (Shyft typically charges per subscription)
            credit_monitor_1.creditMonitor.recordUsage('shyft_websocket', 1, 1);
        });
        logger_1.logger.info('Subscribed to Solana tokens via Shyft WebSocket', { count: solanaTokens.length });
    }
    /**
     * Handle WebSocket messages from Shyft
     */
    handleWebSocketMessage(message) {
        // Shyft sends price updates in this format
        if (message.method === 'token_price' || message.channel === 'token_price') {
            const tokenAddress = message.params?.token || message.token;
            const price = message.params?.price || message.price;
            const timestamp = message.params?.timestamp || message.timestamp || Date.now();
            if (!tokenAddress || !price)
                return;
            // Find monitor for this token (Solana only)
            const monitor = Array.from(this.activeMonitors.values()).find((m) => m.chain === 'solana' && m.tokenAddress.toLowerCase() === tokenAddress.toLowerCase());
            if (!monitor)
                return;
            this.updateTokenPrice(monitor, parseFloat(price), timestamp);
            return;
        }
        // Handle other Shyft message types if needed
        if (message.result && message.result.price) {
            const tokenAddress = message.result.token;
            const price = message.result.price;
            const timestamp = message.result.timestamp || Date.now();
            if (!tokenAddress || !price)
                return;
            const monitor = Array.from(this.activeMonitors.values()).find((m) => m.chain === 'solana' && m.tokenAddress.toLowerCase() === tokenAddress.toLowerCase());
            if (!monitor)
                return;
            this.updateTokenPrice(monitor, parseFloat(price), timestamp);
        }
    }
    /**
     * Reconnect WebSocket with exponential backoff
     */
    reconnectWebSocket() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger_1.logger.error('Max reconnection attempts reached');
            return;
        }
        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        logger_1.logger.info('Reconnecting to WebSocket', {
            attempt: this.reconnectAttempts,
            delayMs: delay,
        });
        setTimeout(() => {
            if (this.isRunning) {
                this.connectWebSocket();
            }
        }, delay);
    }
    /**
     * Start RPC polling for ETH/BSC tokens (1 minute interval)
     */
    startRPCPolling() {
        this.rpcPollInterval = setInterval(async () => {
            if (!this.isRunning)
                return;
            // Get ETH/BSC tokens only
            const ethBscTokens = Array.from(this.activeMonitors.values()).filter((m) => m.chain === 'ethereum' || m.chain === 'bsc' || m.chain === 'eth' || m.chain === 'binance');
            if (ethBscTokens.length === 0)
                return;
            try {
                logger_1.logger.debug('Polling prices for ETH/BSC tokens', { count: ethBscTokens.length });
                await this.updatePricesBatch(ethBscTokens);
                // Record credit usage for RPC calls
                credit_monitor_1.creditMonitor.recordUsage('rpc_polling', ethBscTokens.length, ethBscTokens.length);
            }
            catch (error) {
                logger_1.logger.error('Error in RPC price polling', error);
            }
        }, RPC_POLL_INTERVAL_MS); // 1 minute
    }
    /**
     * Start periodic price updates (fallback if WebSocket fails for Solana)
     */
    startPeriodicUpdates() {
        this.updateInterval = setInterval(async () => {
            if (!this.isRunning)
                return;
            // Only poll Solana tokens if WebSocket is not connected
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                return; // WebSocket is working, skip polling
            }
            // Batch fetch prices for Solana tokens (fallback)
            const solanaTokens = Array.from(this.activeMonitors.values()).filter((m) => m.chain === 'solana');
            if (solanaTokens.length === 0)
                return;
            try {
                await this.updatePricesBatch(solanaTokens);
                credit_monitor_1.creditMonitor.recordUsage('birdeye_fallback', solanaTokens.length, solanaTokens.length);
            }
            catch (error) {
                logger_1.logger.error('Error in periodic price update', error);
            }
        }, 10000); // Every 10 seconds (fallback only)
    }
    /**
     * Batch update prices for multiple tokens
     */
    async updatePricesBatch(monitors) {
        // Group by chain
        const solanaTokens = monitors
            .filter((m) => m.chain === 'solana')
            .map((m) => m.tokenAddress);
        if (solanaTokens.length === 0)
            return;
        // Check cache first (in-memory and database)
        const uncachedTokens = [];
        const now = Date.now();
        for (const monitor of monitors) {
            const cacheKey = `${monitor.chain}:${monitor.tokenAddress}`.toLowerCase();
            const cached = this.priceCache.get(cacheKey);
            if (cached && now - cached.timestamp < PRICE_CACHE_TTL_MS) {
                // Use cached price
                this.updateTokenPrice(monitor, cached.price, cached.timestamp);
            }
            else {
                // Check database cache
                try {
                    const dbCachedPrice = await (0, live_trade_database_1.getCachedPrice)(monitor.tokenAddress, monitor.chain, PRICE_CACHE_TTL_MS / 1000);
                    if (dbCachedPrice !== null) {
                        // Update in-memory cache
                        this.priceCache.set(cacheKey, {
                            price: dbCachedPrice,
                            timestamp: now,
                        });
                        this.updateTokenPrice(monitor, dbCachedPrice, now);
                        continue;
                    }
                }
                catch (error) {
                    // Ignore database cache errors
                }
                uncachedTokens.push(monitor);
            }
        }
        if (uncachedTokens.length === 0)
            return;
        // Fetch prices from Birdeye API (efficient batch)
        try {
            // Fetch prices one by one with rate limiting (Birdeye doesn't have batch endpoint)
            // But we cache aggressively to minimize calls
            for (const monitor of uncachedTokens) {
                try {
                    const price = await this.fetchPriceFromBirdeye(monitor.tokenAddress);
                    if (price && price > 0) {
                        const now = Date.now();
                        // Cache the price (in-memory and database)
                        const cacheKey = `${monitor.chain}:${monitor.tokenAddress}`.toLowerCase();
                        this.priceCache.set(cacheKey, {
                            price,
                            timestamp: now,
                        });
                        // Store in database cache
                        try {
                            await (0, live_trade_database_1.storePriceCache)(monitor.tokenAddress, monitor.chain, price, undefined, Math.floor(now / 1000));
                        }
                        catch (error) {
                            // Ignore storage errors
                        }
                        this.updateTokenPrice(monitor, price, now);
                    }
                }
                catch (error) {
                    logger_1.logger.debug('Error fetching price for token', { tokenAddress: monitor.tokenAddress });
                }
            }
        }
        catch (error) {
            logger_1.logger.error('Error fetching batch prices', error);
        }
    }
    /**
     * Update token price and check for entry conditions
     */
    updateTokenPrice(monitor, price, timestamp) {
        monitor.lastPrice = price;
        monitor.lastUpdateTime = timestamp;
        // Update candles
        this.updateCandles(monitor, price, timestamp);
        // Check entry conditions if we have enough candles
        if (monitor.candles.length >= MIN_CANDLES_FOR_ENTRY) {
            this.checkEntryConditions(monitor);
        }
    }
    /**
     * Update candle data with new price
     */
    updateCandles(monitor, price, timestamp) {
        const now = timestamp;
        const candleInterval = CANDLE_INTERVAL_MS;
        const currentCandleTime = Math.floor(now / candleInterval) * candleInterval;
        if (monitor.candles.length === 0) {
            // First candle
            monitor.candles.push({
                timestamp: currentCandleTime,
                open: price,
                high: price,
                low: price,
                close: price,
                volume: 0,
            });
        }
        else {
            const lastCandle = monitor.candles[monitor.candles.length - 1];
            if (currentCandleTime === lastCandle.timestamp) {
                // Update existing candle
                lastCandle.high = Math.max(lastCandle.high, price);
                lastCandle.low = Math.min(lastCandle.low, price);
                lastCandle.close = price;
            }
            else {
                // New candle
                monitor.candles.push({
                    timestamp: currentCandleTime,
                    open: price,
                    high: price,
                    low: price,
                    close: price,
                    volume: 0,
                });
                // Recalculate indicators when new candle is created
                this.recalculateIndicators(monitor);
            }
        }
        // Update lowest price tracking
        if (!monitor.lowestPrice || price < monitor.lowestPrice) {
            monitor.lowestPrice = price;
            monitor.lowestPriceTime = timestamp;
        }
    }
    /**
     * Recalculate indicators for all candles
     */
    recalculateIndicators(monitor) {
        monitor.indicatorHistory = [];
        let previousEMAs = {};
        for (let i = 0; i < monitor.candles.length; i++) {
            const indicators = (0, indicators_1.calculateIndicators)(monitor.candles, i, previousEMAs);
            monitor.indicatorHistory.push(indicators);
            previousEMAs = {
                ema9: indicators.movingAverages.ema9,
                ema20: indicators.movingAverages.ema20,
                ema50: indicators.movingAverages.ema50,
            };
        }
    }
    /**
     * Load enabled strategies from database
     */
    async loadEnabledStrategies() {
        try {
            this.enabledStrategies = await (0, live_trade_strategies_1.getEnabledStrategies)();
            logger_1.logger.debug('Loaded enabled strategies', { count: this.enabledStrategies.size });
        }
        catch (error) {
            logger_1.logger.error('Failed to load enabled strategies', error);
            // Default to all enabled on error
            this.enabledStrategies = new Set(['initial_entry', 'trailing_entry', 'ichimoku_tenkan_kijun']);
        }
    }
    /**
     * Check entry conditions using strategy logic
     */
    checkEntryConditions(monitor) {
        if (monitor.entrySignalSent) {
            return; // Already sent entry signal
        }
        const currentPrice = monitor.lastPrice || monitor.candles[monitor.candles.length - 1].close;
        const currentIndex = monitor.candles.length - 1;
        const current = monitor.indicatorHistory[currentIndex];
        const previous = monitor.indicatorHistory[currentIndex - 1];
        if (!current || !previous)
            return;
        // 1. Check initial entry condition (price drop from alert price)
        if (this.enabledStrategies.has('initial_entry') &&
            !monitor.initialEntryTriggered &&
            monitor.entryConfig.initialEntry !== 'none') {
            const dropPercent = monitor.entryConfig.initialEntry; // e.g., -0.1 for 10% drop
            const entryTriggerPrice = monitor.alertPrice * (1 + dropPercent);
            // Check if price has dropped to or below trigger level
            if (currentPrice <= entryTriggerPrice) {
                monitor.initialEntryTriggered = true;
                monitor.entryPrice = entryTriggerPrice;
                monitor.entryTime = Date.now();
                monitor.entrySignalSent = true;
                monitor.inPosition = true;
                const dropPercentDisplay = Math.abs(dropPercent) * 100;
                this.sendEntryAlert(monitor, 'initial', `Price dropped ${dropPercentDisplay.toFixed(1)}% from alert (${entryTriggerPrice.toFixed(8)})`);
                return;
            }
        }
        // 2. Check trailing entry condition (rebound from low)
        // Only check if initial entry was triggered OR if initial entry is disabled
        if (this.enabledStrategies.has('trailing_entry') &&
            (monitor.initialEntryTriggered || monitor.entryConfig.initialEntry === 'none') &&
            !monitor.trailingEntryTriggered &&
            !monitor.entrySignalSent &&
            monitor.entryConfig.trailingEntry !== 'none' &&
            monitor.lowestPrice) {
            const trailingPercent = monitor.entryConfig.trailingEntry; // e.g., 0.05 for 5% rebound
            const trailingTriggerPrice = monitor.lowestPrice * (1 + trailingPercent);
            if (currentPrice >= trailingTriggerPrice) {
                monitor.trailingEntryTriggered = true;
                monitor.entryPrice = trailingTriggerPrice;
                monitor.entryTime = Date.now();
                monitor.entrySignalSent = true;
                monitor.inPosition = true;
                const reboundPercent = trailingPercent * 100;
                this.sendEntryAlert(monitor, 'trailing', `Price rebounded ${reboundPercent.toFixed(1)}% from low (${monitor.lowestPrice.toFixed(8)} → ${trailingTriggerPrice.toFixed(8)})`);
                return;
            }
        }
        // 3. Check Ichimoku signals (if initial entry already triggered or immediate entry enabled)
        // Only check if we haven't sent an entry signal yet
        if (!monitor.entrySignalSent &&
            (monitor.initialEntryTriggered || monitor.entryConfig.initialEntry === 'none') &&
            current.ichimoku &&
            previous.ichimoku) {
            const signals = (0, ichimoku_1.detectIchimokuSignals)(current.ichimoku, previous.ichimoku, currentPrice, Date.now());
            // Look for bullish entry signals (filter by enabled strategies)
            const bullishSignals = signals.filter((s) => s.direction === 'bullish');
            const strongSignals = bullishSignals.filter((s) => {
                // Check if the specific strategy is enabled
                if (s.type === 'tenkan_kijun_cross') {
                    return this.enabledStrategies.has('ichimoku_tenkan_kijun');
                }
                if (s.type === 'cloud_cross') {
                    return this.enabledStrategies.has('ichimoku_cloud_cross');
                }
                if (s.type === 'cloud_exit') {
                    return this.enabledStrategies.has('ichimoku_cloud_exit');
                }
                return false;
            });
            if (strongSignals.length > 0) {
                monitor.entryPrice = currentPrice;
                monitor.entryTime = Date.now();
                monitor.entrySignalSent = true;
                monitor.inPosition = true;
                const signalDescriptions = strongSignals.map((s) => s.description).join(', ');
                this.sendEntryAlert(monitor, 'ichimoku', signalDescriptions, {
                    tenkan: current.ichimoku.tenkan,
                    kijun: current.ichimoku.kijun,
                    ichimokuSignals: strongSignals.map((s) => s.type),
                });
            }
        }
    }
    /**
     * Send entry alert to Telegram groups
     */
    async sendEntryAlert(monitor, entryType, signalDescription, indicators) {
        if (!monitor.entryPrice)
            return;
        const priceChange = ((monitor.entryPrice - monitor.alertPrice) / monitor.alertPrice) * 100;
        const alert = {
            type: 'ENTRY',
            alertId: monitor.alertId,
            tokenAddress: monitor.tokenAddress,
            tokenSymbol: monitor.tokenSymbol,
            chain: monitor.chain,
            callerName: monitor.callerName,
            entryPrice: monitor.entryPrice,
            alertPrice: monitor.alertPrice,
            priceChange,
            timestamp: monitor.entryTime || Date.now(),
            signal: signalDescription,
            entryType,
            indicators,
        };
        // Format message
        const message = this.formatEntryAlertMessage(alert);
        // Send to all configured groups
        if (this.telegramBot && ALERT_GROUP_IDS.length > 0) {
            for (const groupId of ALERT_GROUP_IDS) {
                try {
                    await this.telegramBot.telegram.sendMessage(groupId, message, {
                        parse_mode: 'Markdown',
                    });
                    logger_1.logger.info('Entry alert sent to Telegram group', {
                        groupId,
                        tokenSymbol: monitor.tokenSymbol,
                        entryType,
                    });
                }
                catch (error) {
                    logger_1.logger.error('Failed to send alert to Telegram group', error, {
                        groupId,
                    });
                }
            }
        }
        // Emit event for other listeners
        this.emit('entryAlert', alert);
        // Store alert in database
        try {
            await (0, live_trade_database_1.storeEntryAlert)({
                alertId: alert.alertId,
                tokenAddress: alert.tokenAddress,
                tokenSymbol: alert.tokenSymbol,
                chain: alert.chain,
                callerName: alert.callerName,
                alertPrice: alert.alertPrice,
                entryPrice: alert.entryPrice,
                entryType: alert.entryType,
                signal: alert.signal,
                priceChange: alert.priceChange,
                timestamp: alert.timestamp,
                sentToGroups: ALERT_GROUP_IDS.map(String),
            });
            // Update monitored token entry information
            const key = `${alert.chain}:${alert.tokenAddress}`.toLowerCase();
            const monitor = this.activeMonitors.get(key);
            if (monitor) {
                // Try to find the monitored token ID from Postgres
                // For now, we'll update by token address + caller + alert time
                // In a full implementation, we'd store the ID when adding the token
                try {
                    const { getActiveMonitoredTokens } = await Promise.resolve().then(() => __importStar(require('../utils/monitored-tokens-db')));
                    const monitoredTokens = await getActiveMonitoredTokens();
                    const monitoredToken = monitoredTokens.find(mt => mt.tokenAddress.toLowerCase() === alert.tokenAddress.toLowerCase() &&
                        mt.chain === alert.chain &&
                        mt.callerName === alert.callerName &&
                        Math.abs(mt.alertTimestamp.getTime() - new Date(monitor.alertTime).getTime()) < 60000 // Within 1 minute
                    );
                    if (monitoredToken?.id) {
                        await (0, monitored_tokens_db_1.updateMonitoredTokenEntry)(monitoredToken.id, alert.entryPrice, new Date(alert.timestamp), alert.entryType);
                    }
                }
                catch (error) {
                    logger_1.logger.warn('Failed to update monitored token entry', error);
                }
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to store entry alert', error);
        }
    }
    /**
     * Format entry alert message for Telegram
     */
    formatEntryAlertMessage(alert) {
        const entryEmoji = alert.entryType === 'initial' ? '📉' : alert.entryType === 'trailing' ? '📈' : '🎯';
        const priceChangeEmoji = alert.priceChange >= 0 ? '📈' : '📉';
        let message = `${entryEmoji} *ENTRY SIGNAL TRIGGERED* ${entryEmoji}\n\n`;
        message += `🪙 *Token:* ${alert.tokenSymbol}\n`;
        message += `📍 *Address:* \`${alert.tokenAddress}\`\n`;
        message += `🔗 *Chain:* ${alert.chain}\n`;
        message += `👤 *Caller:* ${alert.callerName}\n\n`;
        message += `💰 *Entry Price:* $${alert.entryPrice.toFixed(8)}\n`;
        message += `📊 *Alert Price:* $${alert.alertPrice.toFixed(8)}\n`;
        message += `${priceChangeEmoji} *Change:* ${alert.priceChange >= 0 ? '+' : ''}${alert.priceChange.toFixed(2)}%\n\n`;
        message += `🎯 *Entry Type:* ${alert.entryType.toUpperCase()}\n`;
        message += `📡 *Signal:* ${alert.signal}\n`;
        if (alert.indicators) {
            message += `\n📊 *Indicators:*\n`;
            if (alert.indicators.tenkan && alert.indicators.kijun) {
                message += `• Tenkan: $${alert.indicators.tenkan.toFixed(8)}\n`;
                message += `• Kijun: $${alert.indicators.kijun.toFixed(8)}\n`;
            }
            if (alert.indicators.ichimokuSignals && alert.indicators.ichimokuSignals.length > 0) {
                message += `• Signals: ${alert.indicators.ichimokuSignals.join(', ')}\n`;
            }
        }
        message += `\n⏰ *Time:* ${new Date(alert.timestamp).toLocaleString()}`;
        return message;
    }
    /**
     * Add a token to monitoring manually
     * Optionally pre-populate with historical candles
     */
    async addToken(alert, entryConfig, historicalCandles) {
        const key = `${alert.chain}:${alert.tokenAddress}`.toLowerCase();
        if (this.activeMonitors.has(key)) {
            logger_1.logger.warn('Token already being monitored', { tokenAddress: alert.tokenAddress });
            return;
        }
        if (!alert.priceAtAlert || alert.priceAtAlert <= 0) {
            logger_1.logger.warn('Cannot monitor token without alert price', {
                tokenAddress: alert.tokenAddress,
            });
            return;
        }
        // Initialize candles - use provided historical candles or start empty
        let initialCandles = [];
        if (historicalCandles && historicalCandles.length > 0) {
            initialCandles = historicalCandles;
            logger_1.logger.info('Pre-populating monitor with historical candles', {
                tokenAddress: alert.tokenAddress.substring(0, 20),
                candleCount: historicalCandles.length,
            });
        }
        const monitor = {
            alertId: alert.id || 0,
            tokenAddress: alert.tokenAddress,
            tokenSymbol: alert.tokenSymbol || alert.tokenAddress.slice(0, 8),
            chain: alert.chain,
            callerName: alert.callerName,
            alertTime: alert.alertTimestamp,
            alertPrice: alert.priceAtAlert,
            candles: initialCandles,
            indicatorHistory: [],
            entrySignalSent: false,
            inPosition: false,
            initialEntryTriggered: false,
            trailingEntryTriggered: false,
            entryConfig: entryConfig || DEFAULT_ENTRY_CONFIG,
        };
        // If we have historical candles, calculate indicators immediately
        if (initialCandles.length > 0) {
            this.recalculateIndicators(monitor);
            // Update lowest price from historical data
            for (const candle of initialCandles) {
                if (!monitor.lowestPrice || candle.low < monitor.lowestPrice) {
                    monitor.lowestPrice = candle.low;
                    monitor.lowestPriceTime = candle.timestamp * 1000; // Convert to milliseconds
                }
            }
            // Set last price from most recent candle
            const lastCandle = initialCandles[initialCandles.length - 1];
            monitor.lastPrice = lastCandle.close;
            monitor.lastUpdateTime = lastCandle.timestamp * 1000;
        }
        this.activeMonitors.set(key, monitor);
        // Store in Postgres for watchlist access
        try {
            await (0, monitored_tokens_db_1.storeMonitoredToken)({
                tokenAddress: alert.tokenAddress,
                chain: alert.chain,
                tokenSymbol: alert.tokenSymbol,
                callerName: alert.callerName,
                alertTimestamp: alert.alertTimestamp,
                alertPrice: alert.priceAtAlert,
                entryConfig: entryConfig || DEFAULT_ENTRY_CONFIG,
                status: 'active',
                historicalCandlesCount: initialCandles.length,
                lastPrice: monitor.lastPrice,
                lastUpdateTime: monitor.lastUpdateTime ? new Date(monitor.lastUpdateTime) : undefined,
            });
        }
        catch (error) {
            logger_1.logger.warn('Failed to store monitored token in Postgres', error, {
                tokenAddress: alert.tokenAddress.substring(0, 20),
            });
            // Continue even if storage fails
        }
        // Subscribe if WebSocket is connected (Solana only)
        if (alert.chain === 'solana' && this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.subscribeToSolanaTokens();
        }
        // ETH/BSC tokens will be polled via RPC polling interval
        logger_1.logger.info('Added token to live monitoring', {
            tokenSymbol: monitor.tokenSymbol,
            callerName: monitor.callerName,
            historicalCandles: initialCandles.length,
        });
    }
    /**
     * Fetch price from Birdeye API with caching
     */
    async fetchPriceFromBirdeye(tokenAddress) {
        try {
            // Use Birdeye API directly with rate limiting
            const response = await axios_1.default.get(`https://public-api.birdeye.so/defi/token_overview`, {
                params: { address: tokenAddress },
                headers: {
                    'X-API-KEY': BIRDEYE_API_KEY,
                    'accept': 'application/json',
                    'x-chain': 'solana',
                },
                timeout: 5000,
            });
            if (response.data?.success && response.data?.data?.price) {
                return parseFloat(response.data.data.price);
            }
        }
        catch (error) {
            // Silently fail - will retry later
        }
        return null;
    }
    /**
     * Get monitoring status
     */
    getStatus() {
        const solanaTokens = Array.from(this.activeMonitors.values()).filter((m) => m.chain === 'solana').length;
        const ethBscTokens = Array.from(this.activeMonitors.values()).filter((m) => m.chain === 'ethereum' || m.chain === 'bsc' || m.chain === 'eth' || m.chain === 'binance').length;
        return {
            isRunning: this.isRunning,
            monitoredTokens: this.activeMonitors.size,
            websocketConnected: this.ws?.readyState === WebSocket.OPEN,
            alertGroups: ALERT_GROUP_IDS.length,
            solanaTokens,
            ethBscTokens,
            creditUsage: credit_monitor_1.creditMonitor.getReport(),
        };
    }
}
exports.LiveTradeAlertService = LiveTradeAlertService;
exports.default = LiveTradeAlertService;
//# sourceMappingURL=live-trade-alert-service.js.map