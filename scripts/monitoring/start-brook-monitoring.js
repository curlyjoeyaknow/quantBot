#!/usr/bin/env ts-node
"use strict";
/**
 * Start Brook Channel Monitoring
 * ==============================
 * Complete monitoring setup for Brook's channel:
 * 1. Forwards messages from Brook's channel to your personal Telegram
 * 2. Ingests forwarded calls into database and live monitoring
 *
 * Usage:
 *   BROOK_CHANNEL_ID=<channel_id> \
 *   PERSONAL_CHAT_ID=<your_chat_id> \
 *   TELEGRAM_BOT_TOKEN=<bot_token> \
 *   ts-node scripts/monitoring/start-brook-monitoring.ts
 *
 * Environment Variables:
 *   - BROOK_CHANNEL_ID: Telegram channel ID or username (e.g., @brookchannel or -1001234567890)
 *   - PERSONAL_CHAT_ID: Your personal Telegram chat ID to forward messages to
 *   - TELEGRAM_BOT_TOKEN: Bot token for the monitoring bot
 *   - HELIUS_API_KEY: (Optional) For live price monitoring
 *   - BIRDEYE_API_KEY: (Required) For token metadata
 *   - SHYFT_X_TOKEN: (Optional) For Tenkan/Kijun service
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
require("dotenv/config");
const logger_1 = require("../../src/utils/logger");
const database_1 = require("../../src/utils/database");
const live_trade_alert_service_1 = require("../../src/monitoring/live-trade-alert-service");
const tenkan_kijun_alert_service_1 = require("../../src/monitoring/tenkan-kijun-alert-service");
const brook_call_ingestion_1 = require("../../src/monitoring/brook-call-ingestion");
const PERSONAL_CHAT_ID = process.env.PERSONAL_CHAT_ID || '';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '';
const ENABLE_LIVE_TRADE = process.env.ENABLE_LIVE_TRADE_ALERTS === 'true';
const ENABLE_TENKAN_KIJUN = process.env.ENABLE_TENKAN_KIJUN_ALERTS === 'true';
async function main() {
    logger_1.logger.info('Starting Brook channel monitoring system...');
    logger_1.logger.info('This system listens to your personal Telegram chat for manually forwarded messages from Brook\'s channel.');
    // Validate required environment variables
    if (!PERSONAL_CHAT_ID) {
        logger_1.logger.error('PERSONAL_CHAT_ID environment variable is required');
        logger_1.logger.error('This is your personal Telegram chat ID where you forward messages from Brook\'s channel');
        process.exit(1);
    }
    if (!BOT_TOKEN) {
        logger_1.logger.error('TELEGRAM_BOT_TOKEN or BOT_TOKEN environment variable is required');
        process.exit(1);
    }
    // Initialize database
    try {
        await (0, database_1.initDatabase)();
        logger_1.logger.info('Database initialized');
    }
    catch (error) {
        logger_1.logger.error('Failed to initialize database', error);
        process.exit(1);
    }
    // Initialize monitoring services
    let liveTradeService = null;
    let tenkanKijunService = null;
    if (ENABLE_LIVE_TRADE) {
        try {
            liveTradeService = new live_trade_alert_service_1.LiveTradeAlertService();
            await liveTradeService.start();
            logger_1.logger.info('Live trade alert service started');
        }
        catch (error) {
            logger_1.logger.error('Failed to start live trade service', error);
            // Continue without it
        }
    }
    if (ENABLE_TENKAN_KIJUN) {
        try {
            tenkanKijunService = new tenkan_kijun_alert_service_1.TenkanKijunAlertService();
            await tenkanKijunService.start();
            logger_1.logger.info('Tenkan/Kijun alert service started');
        }
        catch (error) {
            logger_1.logger.error('Failed to start Tenkan/Kijun service', error);
            // Continue without it
        }
    }
    // Start Brook call ingestion
    try {
        const ingestion = new brook_call_ingestion_1.BrookCallIngestion(BOT_TOKEN, PERSONAL_CHAT_ID, liveTradeService || undefined, tenkanKijunService || undefined);
        await ingestion.start();
        logger_1.logger.info('Brook call ingestion service started');
        // Log status periodically
        setInterval(() => {
            if (liveTradeService) {
                const status = liveTradeService.getStatus();
                logger_1.logger.info('Live trade service status', status);
            }
        }, 60000); // Every minute
        // Graceful shutdown
        const shutdown = async (signal) => {
            logger_1.logger.info(`Received ${signal}, shutting down gracefully...`);
            ingestion.stop();
            if (liveTradeService) {
                await liveTradeService.stop();
            }
            if (tenkanKijunService) {
                tenkanKijunService.stop();
            }
            process.exit(0);
        };
        process.once('SIGINT', () => shutdown('SIGINT'));
        process.once('SIGTERM', () => shutdown('SIGTERM'));
        logger_1.logger.info('Brook channel monitoring system started successfully', {
            personalChatId: PERSONAL_CHAT_ID,
            liveTradeEnabled: ENABLE_LIVE_TRADE,
            tenkanKijunEnabled: ENABLE_TENKAN_KIJUN,
        });
        logger_1.logger.info('Bot is listening to your personal Telegram chat for forwarded messages.');
        logger_1.logger.info('To use: Forward messages from Brook\'s channel to your personal chat, and the bot will automatically process them.');
    }
    catch (error) {
        logger_1.logger.error('Failed to start Brook call ingestion', error);
        process.exit(1);
    }
}
// Run if executed directly
if (require.main === module) {
    main().catch((error) => {
        logger_1.logger.error('Unhandled error', error);
        process.exit(1);
    });
}
//# sourceMappingURL=start-brook-monitoring.js.map