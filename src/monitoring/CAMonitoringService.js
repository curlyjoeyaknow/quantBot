"use strict";
/**
 * CA Monitoring Service
 * =====================
 * Handles business logic for Custom Asset (CA) tracking, alerts, and notifications.
 * Separated from WebSocket management for better modularity and testability.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CAMonitoringService = void 0;
const events_1 = require("events");
const luxon_1 = require("luxon");
const database_1 = require("../utils/database");
const ichimoku_1 = require("../simulation/ichimoku");
const events_2 = require("../events");
const logger_1 = require("../utils/logger");
/**
 * CA Monitoring Service
 * Handles all business logic related to CA tracking and monitoring
 */
class CAMonitoringService extends events_1.EventEmitter {
    constructor(bot) {
        super();
        this.activeCAs = new Map();
        this.bot = bot;
    }
    /**
     * Initialize the monitoring service
     */
    async initialize() {
        logger_1.logger.info('Initializing CA Monitoring Service...');
        await this.loadActiveCAs();
        logger_1.logger.info('CA Monitoring Service initialized', { activeCACount: this.activeCAs.size });
    }
    /**
     * Load active CAs from database
     */
    async loadActiveCAs() {
        try {
            this.activeCAs.clear();
            logger_1.logger.info('No auto-loaded CA tracking entries. Only manually flagged tokens will be monitored.');
        }
        catch (error) {
            logger_1.logger.error('Error loading active CAs', error);
        }
    }
    /**
     * Add a CA to monitoring
     */
    addCAMonitor(ca) {
        const key = `${ca.chain}:${ca.mint}`;
        this.activeCAs.set(key, ca);
        logger_1.logger.info('Added CA monitor', { tokenName: ca.tokenName, tokenSymbol: ca.tokenSymbol, mint: ca.mint });
        // Emit CA monitor added event
        events_2.eventBus.publish(events_2.EventFactory.createSystemEvent('ca.monitor.added', {
            caId: ca.id,
            mint: ca.mint,
            chain: ca.chain,
            tokenName: ca.tokenName,
            tokenSymbol: ca.tokenSymbol
        }, 'CAMonitoringService'));
        this.emit('caAdded', ca);
    }
    /**
     * Remove a CA from monitoring
     */
    removeCAMonitor(chain, mint) {
        const key = `${chain}:${mint}`;
        const ca = this.activeCAs.get(key);
        if (ca) {
            this.activeCAs.delete(key);
            logger_1.logger.info('Removed CA monitor', { tokenName: ca.tokenName, tokenSymbol: ca.tokenSymbol, mint: ca.mint });
            this.emit('caRemoved', ca);
        }
    }
    /**
     * Get all active CA monitors
     */
    getActiveCAs() {
        return new Map(this.activeCAs);
    }
    /**
     * Get CA monitor by key
     */
    getCAMonitor(chain, mint) {
        const key = `${chain}:${mint}`;
        return this.activeCAs.get(key);
    }
    /**
     * Handle price update event
     */
    async handlePriceUpdate(event) {
        const { account, price, marketcap, timestamp } = event;
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
            logger_1.logger.error('Error saving price update', error, { mint: ca.mint });
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
                        `🪙 **${ca.tokenName}** (${ca.tokenSymbol})\n` +
                        `📈 Price: $${currentPrice.toFixed(6)}\n` +
                        `💰 PNL: ${(priceChange * 100).toFixed(2)}%\n` +
                        `📊 Target: ${target.percent * 100}% at ${target.target}x\n\n` +
                        `⏰ ${luxon_1.DateTime.fromMillis(Date.now()).toFormat('yyyy-MM-dd HH:mm:ss')}`
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
                    message: `🛑 *STOP LOSS TRIGGERED!*\n\n` +
                        `🪙 **${ca.tokenName}** (${ca.tokenSymbol})\n` +
                        `📉 Price: $${currentPrice.toFixed(6)}\n` +
                        `💰 PNL: ${(priceChange * 100).toFixed(2)}%\n` +
                        `🛡️ Stop Loss: ${ca.stopLossConfig.initial * 100}%\n\n` +
                        `⏰ ${luxon_1.DateTime.fromMillis(Date.now()).toFormat('yyyy-MM-dd HH:mm:ss')}`
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
    async checkIchimokuLeadingSpanCrosses(ca, currentPrice, timestamp) {
        if (!ca.ichimokuLeadingSpans)
            return;
        const { senkouA, senkouB, cloudTop, cloudBottom } = ca.ichimokuLeadingSpans;
        const alertKey = 'leading_span_cross';
        // Check if price crosses above or below the cloud
        if ((currentPrice > cloudTop || currentPrice < cloudBottom) && !ca.alertsSent.has(alertKey)) {
            const direction = currentPrice > cloudTop ? 'above' : 'below';
            const message = `☁️ *ICHIMOKU CLOUD CROSS!*\n\n` +
                `🪙 **${ca.tokenName}** (${ca.tokenSymbol})\n` +
                `📈 Price: $${currentPrice.toFixed(6)}\n` +
                `☁️ Crossed ${direction} cloud\n` +
                `📊 Cloud Top: $${cloudTop.toFixed(6)}\n` +
                `📊 Cloud Bottom: $${cloudBottom.toFixed(6)}\n\n` +
                `⏰ ${luxon_1.DateTime.fromMillis(timestamp).toFormat('yyyy-MM-dd HH:mm:ss')}`;
            await this.sendAlert(ca, message);
            ca.alertsSent.add(alertKey);
            this.emit('alertSent', { type: 'leading_span_cross', ca, message });
        }
    }
    /**
     * Update candles for Ichimoku analysis
     */
    async updateCandlesForIchimoku(ca, currentPrice, timestamp) {
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
    async checkIchimokuSignals(ca, currentPrice, timestamp) {
        if (ca.candles.length < 52)
            return; // Need at least 52 candles for Ichimoku
        try {
            const currentIndex = ca.candles.length - 1;
            const ichimokuData = (0, ichimoku_1.calculateIchimoku)(ca.candles, currentIndex);
            if (!ichimokuData)
                return;
            const previousIndex = currentIndex - 1;
            const previousIchimoku = previousIndex >= 51 ? (0, ichimoku_1.calculateIchimoku)(ca.candles, previousIndex) : null;
            if (!previousIchimoku)
                return;
            const signals = (0, ichimoku_1.detectIchimokuSignals)(ichimokuData, previousIchimoku, currentPrice, timestamp);
            for (const signal of signals) {
                const alertKey = `ichimoku_${signal.type}`;
                if (!ca.ichimokuSignalsSent.has(alertKey)) {
                    const message = (0, ichimoku_1.formatIchimokuData)(ichimokuData, currentPrice);
                    await this.sendAlert(ca, message);
                    ca.ichimokuSignalsSent.add(alertKey);
                    this.emit('alertSent', { type: 'ichimoku_signal', ca, message, data: signal });
                }
            }
            ca.lastIchimoku = ichimokuData;
        }
        catch (error) {
            logger_1.logger.error('Error checking Ichimoku signals', error, { mint: ca.mint });
        }
    }
    /**
     * Send alert to user
     */
    async sendAlert(ca, message) {
        try {
            await this.bot.telegram.sendMessage(ca.chatId, message, { parse_mode: 'Markdown' });
            await (0, database_1.saveAlertSent)(ca.id, 'custom_alert', ca.lastPrice || 0, Date.now());
        }
        catch (error) {
            logger_1.logger.error('Error sending alert', error, { mint: ca.mint });
        }
    }
    /**
     * Get subscription requests for all active CAs
     */
    getSubscriptionRequests() {
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
    async getPerformanceSummary() {
        const summaries = [];
        for (const [key, ca] of this.activeCAs) {
            if (ca.lastPrice) {
                const priceChange = (ca.lastPrice - ca.callPrice) / ca.callPrice;
                const chainEmoji = ca.chain === 'ethereum' ? '⟠' : ca.chain === 'bsc' ? '🟡' : ca.chain === 'base' ? '🔵' : '◎';
                summaries.push(`${chainEmoji} **${ca.tokenName}** (${ca.tokenSymbol})\n` +
                    `📈 Price: $${ca.lastPrice.toFixed(6)} (${(priceChange * 100).toFixed(2)}%)\n` +
                    `💰 PNL: ${priceChange >= 0 ? '📈' : '📉'} ${(priceChange * 100).toFixed(2)}%\n`);
            }
        }
        if (summaries.length === 0) {
            return '📊 **Performance Summary**\n\nNo active CA monitoring.';
        }
        return `📊 **Performance Summary**\n\n${summaries.join('\n')}`;
    }
}
exports.CAMonitoringService = CAMonitoringService;
//# sourceMappingURL=CAMonitoringService.js.map