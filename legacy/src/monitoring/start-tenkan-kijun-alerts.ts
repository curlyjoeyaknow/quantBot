#!/usr/bin/env ts-node
/**
 * Start Tenkan/Kijun Cross Alert Service
 * Standalone service that monitors tokens and sends alerts
 */

import 'dotenv/config';
import { TenkanKijunAlertService } from './tenkan-kijun-alert-service';
import { logger } from '../utils/logger';

// Telegram bot for sending alerts (optional)
let bot: any = null;

try {
  const { Telegraf } = require('telegraf');
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  
  if (TELEGRAM_BOT_TOKEN) {
    bot = new Telegraf(TELEGRAM_BOT_TOKEN);
    logger.info('Telegram bot initialized');
  }
} catch (error) {
  logger.warn('Telegram bot not available (optional)');
}

// Alert channels (Telegram chat IDs)
const ALERT_CHAT_IDS = process.env.ALERT_CHAT_IDS?.split(',').map(id => parseInt(id.trim())) || [];

async function sendAlert(alert: any): Promise<void> {
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
      } catch (error) {
        logger.error('Failed to send alert to chat', error as Error, { chatId });
      }
    }
  }

  // Also log using structured logger
  logger.info('Alert sent', { type: alert.type, tokenSymbol: alert.tokenSymbol, tokenAddress: alert.tokenAddress, price: alert.price });
}

async function main() {
  logger.info('Starting Tenkan/Kijun Cross Alert Service...');

  const service = new TenkanKijunAlertService(
    process.env.SHYFT_API_KEY,
    process.env.SHYFT_WS_URL,
    process.env.SHYFT_X_TOKEN,
    process.env.SHYFT_GRPC_URL
  );

  // Listen for alerts
  service.on('alert', async (alert) => {
    await sendAlert(alert);
  });

  // Start the service
  await service.start();

  // Keep running
  process.on('SIGINT', () => {
    logger.info('Shutting down (SIGINT)...');
    service.stop();
    if (bot) {
      bot.stop('SIGINT');
    }
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('Shutting down (SIGINT)...');
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
    logger.info('Initial Status Check (30 seconds after start)');
    service.logStatus();
  }, 30 * 1000);
}

main().catch((error) => {
  logger.error('Failed to start alert service', error as Error);
  process.exit(1);
});

