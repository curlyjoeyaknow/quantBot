#!/usr/bin/env ts-node
/**
 * Start Live Trade Alert Service
 * ===============================
 * Standalone service that monitors tokens from caller_alerts database
 * and sends entry alerts to Telegram groups
 */

import 'dotenv/config';
import { LiveTradeAlertService } from './live-trade-alert-service';
import { logger } from '@quantbot/utils';
import { initDatabase } from '@quantbot/utils';

async function main() {
  logger.info('Starting Live Trade Alert Service...');

  // Initialize database
  try {
    await initDatabase();
    logger.info('Database initialized');
  } catch (error) {
    logger.error('Failed to initialize database', error as Error);
    process.exit(1);
  }

  // Create service instance
  const service = new LiveTradeAlertService();

  // Handle entry alerts
  service.on('entryAlert', (alert) => {
    logger.info('Entry alert triggered', {
      tokenSymbol: alert.tokenSymbol,
      entryType: alert.entryType,
      entryPrice: alert.entryPrice,
    });
  });

  // Start the service
  try {
    await service.start();
    logger.info('Live Trade Alert Service started successfully');

    // Log status periodically
    setInterval(() => {
      const status = service.getStatus();
      logger.info('Service status', status);
    }, 60000); // Every minute

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down gracefully...');
      await service.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down gracefully...');
      await service.stop();
      process.exit(0);
    });
  } catch (error) {
    logger.error('Failed to start service', error as Error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    logger.error('Fatal error', error as Error);
    process.exit(1);
  });
}

export default main;
