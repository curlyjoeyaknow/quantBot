/**
 * QuantBot Telegram Bot Service
 * ==============================
 * Lightweight Telegram bot service for alerts and commands
 * 
 * This service is separate from the core reporting/simulation service
 * and communicates via shared database access.
 */

import { Telegraf } from 'telegraf';
import * as dotenv from 'dotenv';
import { ServiceContainer } from './container/ServiceContainer';
import { CommandRegistry } from './commands/CommandRegistry';
import { getDatabaseClient } from './database/client';
import { logger } from './utils/logger';

// Load environment variables
dotenv.config();

// Validate required environment variables
if (!process.env.BOT_TOKEN && !process.env.TELEGRAM_BOT_TOKEN) {
  logger.error('BOT_TOKEN or TELEGRAM_BOT_TOKEN environment variable is required');
  process.exit(1);
}

// Initialize bot
const bot = new Telegraf(process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN!);

// -----------------------------------------------------------------------------
// Service Container Setup
// -----------------------------------------------------------------------------

const serviceContainer = ServiceContainer.getInstance({ bot });

// -----------------------------------------------------------------------------
// Command Registry Setup
// -----------------------------------------------------------------------------

const commandRegistry = new CommandRegistry(
  bot,
  serviceContainer.getService('sessionService'),
  serviceContainer.getService('strategyService'),
  serviceContainer.getService('simulationService')
);

// -----------------------------------------------------------------------------
// Text Workflow Registration
// -----------------------------------------------------------------------------

const textWorkflowHandler = serviceContainer.getService('textWorkflowHandler');

bot.on('text', async (ctx) => {
  try {
    const userId = ctx.from?.id;
    const messageText = (ctx.message as any)?.text?.substring(0, 50);
    logger.debug('Received text message', { userId, messageText });
    await textWorkflowHandler.handleText(ctx);
  } catch (error) {
    logger.error('Error handling text message', error as Error, { userId: ctx.from?.id });
    await ctx.reply('❌ An error occurred processing your message. Please try again.');
  }
});

// Handle callback queries (button presses)
bot.on('callback_query', async (ctx) => {
  try {
    const userId = ctx.from?.id;
    const callbackData = (ctx.callbackQuery as any)?.data;
    logger.debug('Received callback query', { userId, callbackData });
    await textWorkflowHandler.handleCallbackQuery(ctx);
  } catch (error) {
    logger.error('Error handling callback query', error as Error, { userId: ctx.from?.id });
    await ctx.answerCbQuery('❌ An error occurred. Please try again.');
  }
});

// -----------------------------------------------------------------------------
// Bot Startup and Shutdown
// -----------------------------------------------------------------------------

// Error handling
bot.catch((err, ctx) => {
  logger.error('Bot error', err, { userId: ctx.from?.id });
  ctx.reply('❌ An error occurred. Please try again.');
});

// Start bot
(async () => {
  try {
    // Initialize database connection
    logger.info('Initializing database connection...');
    const dbClient = getDatabaseClient();
    await dbClient.initialize({
      databaseUrl: process.env.DATABASE_URL,
      callerDbPath: process.env.CALLER_DB_PATH,
    });
    logger.info('Database initialized successfully');
    
    // Launch bot
    logger.info('Launching bot...');
    await bot.launch();
    logger.info('QuantBot Telegram service started successfully');
    logger.info('Services initialized', { healthStatus: serviceContainer.getHealthStatus() });
    
    // Set up Telegram bot commands menu
    logger.info('Setting up bot commands menu...');
    await commandRegistry.setupBotCommands();
    logger.info('Bot commands menu set up successfully');
  } catch (error) {
    logger.error('Failed to start bot', error as Error);
    process.exit(1);
  }
})();

// Graceful shutdown
process.once('SIGINT', async () => {
  logger.info('Shutting down QuantBot (SIGINT)...');
  const dbClient = getDatabaseClient();
  await dbClient.close();
  bot.stop('SIGINT');
});

process.once('SIGTERM', async () => {
  logger.info('Shutting down QuantBot (SIGTERM)...');
  const dbClient = getDatabaseClient();
  await dbClient.close();
  bot.stop('SIGTERM');
});

export { bot, serviceContainer, commandRegistry };

