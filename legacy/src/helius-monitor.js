"use strict";
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
exports.HeliusMonitor = void 0;
const ws_1 = __importDefault(require("ws"));
const axios_1 = __importDefault(require("axios"));
const luxon_1 = require("luxon");
const database_1 = require("./utils/database");
const logger_1 = require("./utils/logger");
const ichimoku_1 = require("./simulation/ichimoku");
/* ============================================================================
 * Configuration
 * ============================================================================
 */
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '50c004c8-c6c4-4e1a-a85a-554942ca2368';
const HELIUS_WS_URL = `wss://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
/* ============================================================================
 * HeliusMonitor Class
 * ============================================================================
 */
class HeliusMonitor {
    /**
     * @param bot - Telegram bot instance for sending alerts and summaries.
     */
    constructor(bot) {
        // --- Core State
        this.ws = null; // Current WebSocket connection (null if idle)
        this.activeCAs = new Map(); // `${chain}:${mint}` => CAMonitor
        this.reconnectAttempts = 0; // For reconnection backoff
        this.maxReconnectAttempts = 5; // Exponential backoff cap
        this.hasAuthError = false; // Track if we've had auth errors
        /* ==========================================================================
         * FALLBACK POLLING FOR ICHIMOKU ALERTS
         * ========================================================================== */
        this.fallbackPollingInterval = null;
        this.bot = bot;
    }
    /**
     * Start the monitor:
     *   1. Load tracked assets from the database.
     *   2. Connect to the Helius WebSocket.
     *   3. Begin sending scheduled hourly summaries.
     */
    async start() {
        logger_1.logger.info('Starting Helius WebSocket monitoring...');
        await this.loadActiveCAs();
        await this.connect();
        this.scheduleHourlySummaries();
        this.startPeriodicUpdateRequests();
    }
    /**
     * Retrieve and register all active CA trackings from the database.
     * Clears previous cache to ensure full consistency.
     */
    async loadActiveCAs() {
        try {
            // Don't auto-load any tokens - only monitor explicitly flagged tokens
            this.activeCAs.clear();
            logger_1.logger.info('No auto-loaded CA tracking entries. Only manually flagged tokens will be monitored.');
        }
        catch (error) {
            logger_1.logger.error('Error loading active CAs', error);
        }
    }
    /* ==========================================================================
     * Connection & Subscription Management
     * ========================================================================== */
    /**
     * Establishes a persistent connection to the Helius WebSocket endpoint
     * and manages all related events (subscribe, reconnect, protocol errors).
     */
    connect() {
        if (!HELIUS_API_KEY) {
            const error = new Error('HELIUS_API_KEY not set in environment.');
            logger_1.logger.error(error.message);
            return Promise.reject(error);
        }
        logger_1.logger.info('Connecting to Helius WebSocket...');
        return new Promise((resolve, reject) => {
            let isSettled = false;
            const settleResolve = () => {
                if (isSettled)
                    return;
                isSettled = true;
                resolve();
            };
            const settleReject = (error) => {
                if (isSettled)
                    return;
                isSettled = true;
                reject(error);
            };
            let ws;
            try {
                this.ws = new ws_1.default(HELIUS_WS_URL);
                ws = this.ws;
            }
            catch (error) {
                const err = error;
                logger_1.logger.error('Failed to create Helius WebSocket connection', err);
                settleReject(err);
                return;
            }
            ws.on('open', () => {
                logger_1.logger.info('Connected to Helius WebSocket.');
                this.reconnectAttempts = 0;
                this.hasAuthError = false;
                this.subscribeToAllTrackedCAs();
                settleResolve();
            });
            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.handleMessage(message);
                }
                catch (error) {
                    logger_1.logger.error('Error parsing WebSocket message', error);
                }
            });
            ws.on('close', () => {
                logger_1.logger.warn('Helius WebSocket connection closed.');
                if (!isSettled) {
                    settleReject(new Error('Helius WebSocket connection closed before ready.'));
                    return;
                }
                this.handleReconnect();
            });
            ws.on('error', (error) => {
                const err = error;
                logger_1.logger.error('Helius WebSocket error', err);
                if (err.message && err.message.includes('401')) {
                    logger_1.logger.warn('Helius API key invalid - disabling real-time monitoring');
                    logger_1.logger.info('Starting fallback polling for Ichimoku alerts...');
                    this.hasAuthError = true;
                    this.startFallbackPolling();
                    this.stop();
                }
                if (!isSettled) {
                    settleReject(err);
                }
            });
        });
    }
    /**
     * (Re)subscribe to price updates for all currently tracked CAs.
     * Safe no-op if WebSocket is not open.
     */
    subscribeToAllTrackedCAs() {
        if (!this.ws || this.ws.readyState !== ws_1.default.OPEN)
            return;
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
            this.ws.send(JSON.stringify(sub));
        });
        logger_1.logger.info('Subscribed to price updates', { assetCount: subscriptions.length });
    }
    /* ==========================================================================
     * WebSocket Message Handling
     * ========================================================================== */
    /**
     * Central dispatch for WebSocket messages.
     * Easily extendable for new message types.
     * @param message - parsed incoming WS message object
     */
    async handleMessage(message) {
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
    async handlePriceUpdate(params) {
        const { account, price, marketcap, timestamp } = params;
        // Find the CA key whose mint matches the event account
        const caKey = Array.from(this.activeCAs.keys()).find(key => key.endsWith(account));
        if (!caKey)
            return;
        const ca = this.activeCAs.get(caKey);
        const currentPrice = price;
        const priceChange = (currentPrice - ca.callPrice) / ca.callPrice;
        // Persist the update
        try {
            await (0, database_1.savePriceUpdate)(ca.id, currentPrice, marketcap, timestamp);
            ca.lastPrice = currentPrice;
        }
        catch (error) {
            logger_1.logger.error('Error saving price update', error, { caId: ca.id });
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
    async checkAlertsAndNotify(ca, currentPrice, priceChange) {
        const alerts = [];
        // --- Profit Target Alerts ---
        for (const target of ca.strategy) {
            const targetPrice = ca.callPrice * target.target;
            const alertKey = `profit_${target.target}x`;
            if (currentPrice >= targetPrice && !ca.alertsSent.has(alertKey)) {
                alerts.push({
                    type: 'profit_target',
                    message: `🎯 *${target.target}x TARGET HIT!*\n\n` +
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
                message: `🛑 *STOP LOSS TRIGGERED!*\n\n` +
                    `🪙 ${ca.tokenName} (${ca.tokenSymbol})\n` +
                    `📉 Price: $${currentPrice.toFixed(8)} (${(priceChange * 100).toFixed(1)}%)\n` +
                    `🛑 Stop: ${(ca.stopLossConfig.initial * 100).toFixed(0)}% at $${stopLossPrice.toFixed(8)}`
            });
            ca.alertsSent.add(stopLossKey);
        }
        // --- Send Any Alerts Triggered ---
        for (const alert of alerts) {
            try {
                await this.bot.telegram.sendMessage(ca.chatId, alert.message, { parse_mode: 'Markdown' });
                await (0, database_1.saveAlertSent)(ca.id, alert.type, currentPrice, Math.floor(Date.now() / 1000));
                logger_1.logger.info('Sent alert', { alertType: alert.type, tokenName: ca.tokenName, tokenSymbol: ca.tokenSymbol });
            }
            catch (error) {
                logger_1.logger.error('Error sending alert', error, { caId: ca.id, alertType: alert.type });
            }
        }
    }
    /* ==========================================================================
     * Ichimoku Cloud Analysis
     * ========================================================================== */
    /**
     * Check for Ichimoku leading span crosses (immediate price alerts)
     */
    async checkIchimokuLeadingSpanCrosses(ca, currentPrice, timestamp) {
        if (!ca.ichimokuLeadingSpans)
            return;
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
            await (0, database_1.saveAlertSent)(ca.id, 'ichimoku_senkou_a_cross', currentPrice, timestamp);
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
            await (0, database_1.saveAlertSent)(ca.id, 'ichimoku_senkou_b_cross', currentPrice, timestamp);
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
            await (0, database_1.saveAlertSent)(ca.id, 'ichimoku_cloud_cross', currentPrice, timestamp);
        }
    }
    /**
     * Update candles array for Ichimoku analysis
     * Maintains a rolling window of recent 5-minute candles
     * Updates candles periodically from Birdeye API
     */
    async updateCandlesForIchimoku(ca, price, timestamp) {
        if (!ca.lastIchimoku)
            return;
        const now = Date.now();
        const lastUpdate = ca.lastCandleUpdate || 0;
        // Check if price is within 20% of any Ichimoku line for dynamic update frequency
        const ichimoku = ca.lastIchimoku;
        const isNearIchimokuLine = this.isPriceNearIchimokuLines(price, ichimoku);
        // Dynamic update interval based on proximity to Ichimoku lines
        let updateInterval;
        if (isNearIchimokuLine) {
            updateInterval = 5 * 60 * 1000; // 5 minutes when near Ichimoku lines
        }
        else {
            updateInterval = ca.candleUpdateInterval || (45 * 60 * 1000); // 45 minutes default
        }
        // Check if it's time for a candle update
        if (now - lastUpdate >= updateInterval) {
            try {
                await this.updateCandlesFromBirdeye(ca);
                ca.lastCandleUpdate = now;
                // Log the update reason
                if (isNearIchimokuLine) {
                    logger_1.logger.debug('Fast candle update', { tokenName: ca.tokenName, reason: 'near Ichimoku lines' });
                }
            }
            catch (error) {
                logger_1.logger.error('Error updating candles from Birdeye', error, { tokenName: ca.tokenName });
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
    isPriceNearIchimokuLines(currentPrice, ichimoku) {
        const threshold = 0.20; // 20% threshold
        // Check proximity to Tenkan-sen
        if (this.isWithinThreshold(currentPrice, ichimoku.tenkan, threshold))
            return true;
        // Check proximity to Kijun-sen
        if (this.isWithinThreshold(currentPrice, ichimoku.kijun, threshold))
            return true;
        // Check proximity to Senkou Span A
        if (this.isWithinThreshold(currentPrice, ichimoku.senkouA, threshold))
            return true;
        // Check proximity to Senkou Span B
        if (this.isWithinThreshold(currentPrice, ichimoku.senkouB, threshold))
            return true;
        // Check proximity to Cloud boundaries
        if (this.isWithinThreshold(currentPrice, ichimoku.cloudTop, threshold))
            return true;
        if (this.isWithinThreshold(currentPrice, ichimoku.cloudBottom, threshold))
            return true;
        return false;
    }
    /**
     * Check if price is within threshold percentage of a target value
     */
    isWithinThreshold(price, target, threshold) {
        if (target === 0)
            return false; // Avoid division by zero
        const percentageDiff = Math.abs(price - target) / target;
        return percentageDiff <= threshold;
    }
    /**
     * Request frequent price updates from Helius for monitored tokens
     */
    async requestFrequentPriceUpdates(ca) {
        if (!this.ws || this.ws.readyState !== ws_1.default.OPEN)
            return;
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
                logger_1.logger.debug('Requested frequent price updates', { tokenName: ca.tokenName });
            }
            catch (error) {
                logger_1.logger.error('Error requesting frequent price updates', error, { tokenName: ca.tokenName });
            }
        }
    }
    /**
     * Start periodic update requests for all monitored tokens
     * This ensures we get constant price updates from Helius
     */
    startPeriodicUpdateRequests() {
        // Request updates every 60 seconds for all monitored tokens (reduced frequency)
        setInterval(() => {
            if (this.ws && this.ws.readyState === ws_1.default.OPEN && this.activeCAs.size > 0) {
                // Only log every 10th request to reduce spam
                if (Math.random() < 0.1) {
                    logger_1.logger.debug('Requesting updates for monitored tokens', { count: this.activeCAs.size });
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
                    }
                    catch (error) {
                        logger_1.logger.error('Error requesting periodic updates', error, { tokenName: ca.tokenName });
                    }
                }
            }
        }, 60 * 1000); // Every 60 seconds
    }
    /**
     * Update candles from Birdeye API with proper OHLCV data
     */
    async updateCandlesFromBirdeye(ca) {
        try {
            const { fetchHybridCandles } = await Promise.resolve().then(() => __importStar(require('./simulation/candles')));
            // Fetch last 52 candles (about 4.3 hours of 5m data)
            const endTime = luxon_1.DateTime.now().toUTC();
            const startTime = endTime.minus({ minutes: 260 }); // 52 * 5 minutes
            const newCandles = await fetchHybridCandles(ca.mint, startTime, endTime, ca.chain);
            if (newCandles.length >= 52) {
                ca.candles = newCandles;
                // Recalculate Ichimoku data with fresh candles
                const currentIndex = ca.candles.length - 1;
                const newIchimoku = (0, ichimoku_1.calculateIchimoku)(ca.candles, currentIndex);
                if (newIchimoku) {
                    ca.lastIchimoku = newIchimoku;
                    // Update leading spans for price alerts
                    ca.ichimokuLeadingSpans = {
                        senkouA: newIchimoku.senkouA,
                        senkouB: newIchimoku.senkouB,
                        cloudTop: newIchimoku.cloudTop,
                        cloudBottom: newIchimoku.cloudBottom
                    };
                    logger_1.logger.debug('Updated candles and recalculated Ichimoku', { tokenName: ca.tokenName, candleCount: newCandles.length });
                }
            }
        }
        catch (error) {
            logger_1.logger.error('Error updating candles', error, { tokenName: ca.tokenName });
        }
    }
    /**
     * Check for Ichimoku signals and send alerts
     */
    async checkIchimokuSignals(ca, currentPrice, timestamp) {
        // Need at least 52 candles for full Ichimoku calculation
        if (ca.candles.length < 52) {
            return;
        }
        try {
            // Calculate current Ichimoku data
            const currentIndex = ca.candles.length - 1;
            const currentIchimoku = (0, ichimoku_1.calculateIchimoku)(ca.candles, currentIndex);
            if (!currentIchimoku) {
                return;
            }
            // Detect signals if we have previous Ichimoku data
            if (ca.lastIchimoku) {
                const signals = (0, ichimoku_1.detectIchimokuSignals)(currentIchimoku, ca.lastIchimoku, currentPrice, timestamp);
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
        }
        catch (error) {
            logger_1.logger.error('Error in Ichimoku analysis', error, { tokenName: ca.tokenName });
        }
    }
    /**
     * Send a general alert message
     */
    async sendAlert(ca, message) {
        try {
            await this.bot.telegram.sendMessage(ca.chatId, message, { parse_mode: 'Markdown' });
        }
        catch (error) {
            logger_1.logger.error('Error sending alert', error, { tokenName: ca.tokenName });
        }
    }
    /**
     * Send Ichimoku signal alert
     */
    async sendIchimokuAlert(ca, signal, ichimoku, currentPrice) {
        const signalEmoji = signal.direction === 'bullish' ? '🟢' : '🔴';
        const strengthEmoji = signal.strength === 'strong' ? '🔥' :
            signal.strength === 'medium' ? '⚡' : '💡';
        const message = `${signalEmoji} **Ichimoku Signal Detected!**\n\n` +
            `🪙 **${ca.tokenName}** (${ca.tokenSymbol})\n` +
            `📊 **Signal**: ${signal.description}\n` +
            `💰 **Price**: $${currentPrice.toFixed(8)}\n` +
            `💪 **Strength**: ${strengthEmoji} ${signal.strength.toUpperCase()}\n\n` +
            (0, ichimoku_1.formatIchimokuData)(ichimoku, currentPrice);
        try {
            await this.bot.telegram.sendMessage(ca.chatId, message, { parse_mode: 'Markdown' });
            // Save alert to database
            await (0, database_1.saveAlertSent)(ca.id, `ichimoku_${signal.type}`, currentPrice, Math.floor(Date.now() / 1000));
            logger_1.logger.info('Sent Ichimoku alert', { signalType: signal.type, tokenName: ca.tokenName, tokenSymbol: ca.tokenSymbol });
        }
        catch (error) {
            logger_1.logger.error('Error sending Ichimoku alert', error, { tokenName: ca.tokenName });
        }
    }
    /* ==========================================================================
     * Reconnection Logic
     * ========================================================================== */
    /**
     * Attempt to reconnect with exponential backoff.
     * Will cap attempts by maxReconnectAttempts.
     */
    handleReconnect() {
        if (this.hasAuthError) {
            logger_1.logger.warn('Skipping reconnection due to authentication error');
            return;
        }
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger_1.logger.error('Max reconnection attempts reached. Giving up.');
            return;
        }
        this.reconnectAttempts++;
        const delayMs = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        logger_1.logger.warn('Reconnecting to WebSocket', { delayMs, attempt: this.reconnectAttempts });
        setTimeout(() => {
            this.connect().catch(error => logger_1.logger.error('Reconnect attempt failed', error));
        }, delayMs);
    }
    /**
     * Stop the monitor and clean up resources.
     */
    stop() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.stopFallbackPolling();
        this.activeCAs.clear();
        this.reconnectAttempts = 0;
        logger_1.logger.info('Helius monitor stopped.');
    }
    /* ==========================================================================
     * Summary & Reporting
     * ========================================================================== */
    /**
     * Schedule hourly summaries. If production scheduling/cron needed, use a scheduler.
     */
    scheduleHourlySummaries() {
        setInterval(() => {
            this.sendHourlySummary().catch(e => logger_1.logger.error('Error in hourly summary', e));
        }, 60 * 60 * 1000); // Every hour
    }
    /**
     * Build and send an hourly summary for each unique chatId,
     * reporting recent performance on all tracked tokens.
     */
    async sendHourlySummary() {
        try {
            const performance = await (0, database_1.getRecentCAPerformance)(24);
            if (performance.length === 0)
                return;
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
                summary += `⏰ *Last Update:* ${luxon_1.DateTime.now().toFormat('HH:mm')}`;
                try {
                    await this.bot.telegram.sendMessage(chatId, summary, { parse_mode: 'Markdown' });
                }
                catch (error) {
                    logger_1.logger.error('Error sending hourly summary to chat', error, { chatId });
                }
            }
        }
        catch (error) {
            logger_1.logger.error('Error generating hourly summary', error);
        }
    }
    /**
     * Start fallback polling for Ichimoku alerts when WebSocket fails
     */
    startFallbackPolling() {
        if (this.fallbackPollingInterval)
            return;
        logger_1.logger.info('Starting fallback polling for Ichimoku alerts...');
        this.fallbackPollingInterval = setInterval(async () => {
            try {
                await this.pollIchimokuAlerts();
            }
            catch (error) {
                logger_1.logger.error('Error in fallback polling', error);
            }
        }, 30000); // Poll every 30 seconds
    }
    /**
     * Stop fallback polling
     */
    stopFallbackPolling() {
        if (this.fallbackPollingInterval) {
            clearInterval(this.fallbackPollingInterval);
            this.fallbackPollingInterval = null;
            logger_1.logger.info('Stopped fallback polling');
        }
    }
    /**
     * Poll for Ichimoku alerts using REST API
     */
    async pollIchimokuAlerts() {
        if (!HELIUS_API_KEY)
            return;
        for (const [key, ca] of this.activeCAs) {
            if (!ca.lastIchimoku)
                continue;
            try {
                // Get current price from Helius REST API
                const response = await axios_1.default.get(`https://api.helius.xyz/v0/token-metadata`, {
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
            }
            catch (error) {
                logger_1.logger.error('Error polling price', error, { tokenName: ca.tokenName });
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
    async addCATracking(caData) {
        const key = `${caData.chain}:${caData.mint}`;
        this.activeCAs.set(key, {
            ...caData,
            alertsSent: new Set(),
            candles: [],
            ichimokuSignalsSent: new Set()
        });
        // Subscribe to price updates for new CA, if possible
        if (this.ws && this.ws.readyState === ws_1.default.OPEN) {
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
    async addCATrackingWithCandles(caData) {
        const key = `${caData.chain}:${caData.mint}`;
        // Calculate initial Ichimoku data from historical candles
        let initialIchimoku = null;
        if (caData.historicalCandles && caData.historicalCandles.length >= 52) {
            const currentIndex = caData.historicalCandles.length - 1;
            initialIchimoku = (0, ichimoku_1.calculateIchimoku)(caData.historicalCandles, currentIndex);
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
        if (this.ws && this.ws.readyState === ws_1.default.OPEN) {
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
        logger_1.logger.info('Added CA tracking with historical candles', { candleCount: caData.historicalCandles?.length || 0, tokenName: caData.tokenName });
    }
}
exports.HeliusMonitor = HeliusMonitor;
//# sourceMappingURL=helius-monitor.js.map