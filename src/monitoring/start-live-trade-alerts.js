#!/usr/bin/env ts-node
"use strict";
/**
 * Start Live Trade Alert Service
 * ===============================
 * Standalone service that monitors tokens from caller_alerts database
 * and sends entry alerts to Telegram groups
 */
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const live_trade_alert_service_1 = require("./live-trade-alert-service");
const logger_1 = require("../utils/logger");
const database_1 = require("../utils/database");
async function main() {
    logger_1.logger.info('Starting Live Trade Alert Service...');
    // Initialize database
    try {
        await (0, database_1.initDatabase)();
        logger_1.logger.info('Database initialized');
    }
    catch (error) {
        logger_1.logger.error('Failed to initialize database', error);
        process.exit(1);
    }
    // Create service instance
    const service = new live_trade_alert_service_1.LiveTradeAlertService();
    // Handle entry alerts
    service.on('entryAlert', (alert) => {
        logger_1.logger.info('Entry alert triggered', {
            tokenSymbol: alert.tokenSymbol,
            entryType: alert.entryType,
            entryPrice: alert.entryPrice,
        });
    });
    // Start the service
    try {
        await service.start();
        logger_1.logger.info('Live Trade Alert Service started successfully');
        // Log status periodically
        setInterval(() => {
            const status = service.getStatus();
            logger_1.logger.info('Service status', status);
        }, 60000); // Every minute
        // Handle graceful shutdown
        process.on('SIGINT', async () => {
            logger_1.logger.info('Received SIGINT, shutting down gracefully...');
            await service.stop();
            process.exit(0);
        });
        process.on('SIGTERM', async () => {
            logger_1.logger.info('Received SIGTERM, shutting down gracefully...');
            await service.stop();
            process.exit(0);
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to start service', error);
        process.exit(1);
    }
}
// Run if executed directly
if (require.main === module) {
    main().catch((error) => {
        logger_1.logger.error('Fatal error', error);
        process.exit(1);
    });
}
exports.default = main;
//# sourceMappingURL=start-live-trade-alerts.js.map