#!/usr/bin/env ts-node
"use strict";
/**
 * Start Tenkan/Kijun Cross Alert Service
 * Standalone service that monitors tokens and sends alerts
 */
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const tenkan_kijun_alert_service_1 = require("./tenkan-kijun-alert-service");
const logger_1 = require("../utils/logger");
// Telegram bot for sending alerts (optional)
let bot = null;
try {
    const { Telegraf } = require('telegraf');
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    if (TELEGRAM_BOT_TOKEN) {
        bot = new Telegraf(TELEGRAM_BOT_TOKEN);
        logger_1.logger.info('Telegram bot initialized');
    }
}
catch (error) {
    logger_1.logger.warn('Telegram bot not available (optional)');
}
// Alert channels (Telegram chat IDs)
const ALERT_CHAT_IDS = process.env.ALERT_CHAT_IDS?.split(',').map(id => parseInt(id.trim())) || [];
async function sendAlert(alert) {
    const message = `
🚨 **${alert.type} SIGNAL** 🚨

📊 **Token:** ${alert.tokenSymbol}
📍 **Address:** \`${alert.tokenAddress}\`
🔗 **Chain:** ${alert.chain}
👤 **Caller:** ${alert.callerName}

💰 **Price:** $${alert.price.toFixed(6)}
📈 **Signal:** ${alert.signal}

📊 **Indicators:**
• Tenkan: $${alert.tenkan.toFixed(6)}
• Kijun: $${alert.kijun.toFixed(6)}

⏰ **Time:** ${new Date(alert.timestamp).toISOString()}
  `.trim();
    // Send to Telegram if configured
    if (bot && ALERT_CHAT_IDS.length > 0) {
        for (const chatId of ALERT_CHAT_IDS) {
            try {
                await bot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            }
            catch (error) {
                logger_1.logger.error('Failed to send alert to chat', error, { chatId });
            }
        }
    }
    // Also log using structured logger
    logger_1.logger.info('Alert sent', { type: alert.type, tokenSymbol: alert.tokenSymbol, tokenAddress: alert.tokenAddress, price: alert.price });
}
async function main() {
    logger_1.logger.info('Starting Tenkan/Kijun Cross Alert Service...');
    const service = new tenkan_kijun_alert_service_1.TenkanKijunAlertService(process.env.SHYFT_API_KEY, process.env.SHYFT_WS_URL, process.env.SHYFT_X_TOKEN, process.env.SHYFT_GRPC_URL);
    // Listen for alerts
    service.on('alert', async (alert) => {
        await sendAlert(alert);
    });
    // Start the service
    await service.start();
    // Keep running
    process.on('SIGINT', () => {
        logger_1.logger.info('Shutting down (SIGINT)...');
        service.stop();
        if (bot) {
            bot.stop('SIGINT');
        }
        process.exit(0);
    });
    process.on('SIGTERM', () => {
        logger_1.logger.info('Shutting down (SIGINT)...');
        service.stop();
        if (bot) {
            bot.stop('SIGTERM');
        }
        process.exit(0);
    });
    // Log detailed status every 5 minutes
    setInterval(() => {
        service.logStatus();
    }, 5 * 60 * 1000);
    // Also log status immediately after 30 seconds (to verify feed is working)
    setTimeout(() => {
        logger_1.logger.info('Initial Status Check (30 seconds after start)');
        service.logStatus();
    }, 30 * 1000);
}
main().catch((error) => {
    logger_1.logger.error('Failed to start alert service', error);
    process.exit(1);
});
//# sourceMappingURL=start-tenkan-kijun-alerts.js.map