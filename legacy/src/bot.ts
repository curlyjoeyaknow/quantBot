/**
 * QuantBot Main Logic
 * ===================
 * Core logic for QuantBot Telegram bot, enabling backtesting of token strategies and real-time contract address (CA) drop monitoring.
 *
 * Features:
 * - Interactive, stateful chat workflow for simulating and optimizing token trading strategies.
 * - Supports multiple blockchains: Solana, Ethereum, BSC, and Base.
 * - Manages custom strategies (save, use, delete).
 * - Detects and monitors contract drops, automating token tracking.
 *
 * Code Structure:
 *  1. Imports & Initialization
 *  2. ServiceContainer Setup
 *  3. CommandRegistry Setup
 *  4. Text Workflow Registration
 *  5. Bot Startup & Shutdown
 *
 * Design Principles:
 * - Consistent, readable comments.
 * - Maintainability via clear typing & session schema.
 * - Ready for upgrades: settings per session, new chains, strategy types.
 */

// -----------------------------------------------------------------------------
// 1. Imports & Bot Initialization
// -----------------------------------------------------------------------------

import { Telegraf } from 'telegraf';
import * as dotenv from 'dotenv';
import { ServiceContainer } from './container/ServiceContainer';
import { CommandRegistry } from './commands/CommandRegistry';
import { SessionService } from './services/SessionService';
import { SimulationService } from './services/SimulationService';
import { StrategyService } from './services/StrategyService';
import { IchimokuWorkflowService } from './services/IchimokuWorkflowService';
import { CADetectionService } from './services/CADetectionService';
import { RepeatSimulationHelper } from './utils/RepeatSimulationHelper';
import { TextWorkflowHandler } from './services/TextWorkflowHandler';
import { initDatabase } from './utils/database';
import { logger } from './utils/logger';

// Import all command handlers
import {
  BacktestCommandHandler,
  StrategyCommandHandler,
  CancelCommandHandler,
  RepeatCommandHandler,
  CallsCommandHandler,
  CallersCommandHandler,
  RecentCommandHandler,
  ExtractCommandHandler,
  AnalysisCommandHandler,
  HistoryCommandHandler,
  BacktestCallCommandHandler,
  IchimokuCommandHandler,
  AlertCommandHandler,
  AlertsCommandHandler
} from './commands';

// Load environment variables
dotenv.config();

// Initialize bot (support both BOT_TOKEN and TELEGRAM_BOT_TOKEN for compatibility)
const bot = new Telegraf(process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN!);

// -----------------------------------------------------------------------------
// 2. ServiceContainer Setup
// -----------------------------------------------------------------------------

const serviceContainer = ServiceContainer.getInstance({ bot });

// -----------------------------------------------------------------------------
// 3. CommandRegistry Setup
// -----------------------------------------------------------------------------

const commandRegistry = new CommandRegistry(
  bot,
  serviceContainer.getService('sessionService'),
  serviceContainer.getService('strategyService'),
  serviceContainer.getService('simulationService')
);

// -----------------------------------------------------------------------------
// 4. Text Workflow Registration
// -----------------------------------------------------------------------------

const textWorkflowHandler = new TextWorkflowHandler(
  serviceContainer.getService('sessionService'),
  serviceContainer.getService('simulationService'),
  serviceContainer.getService('strategyService'),
  serviceContainer.getService('ichimokuWorkflowService'),
  serviceContainer.getService('caDetectionService'),
  serviceContainer.getService('repeatSimulationHelper')
);

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
// 5. Bot Startup and Persistent Services
// -----------------------------------------------------------------------------

// Error handling
bot.catch((err, ctx) => {
  logger.error('Bot error', err, { userId: ctx.from?.id });
  ctx.reply('❌ An error occurred. Please try again.');
});

// Start bot
(async () => {
  try {
    // Initialize database before starting bot
    logger.info('Initializing database...');
    await initDatabase();
    logger.info('Database initialized successfully');
    
    // Launch bot
    logger.info('Launching bot...');
    await bot.launch();
    logger.info('QuantBot started successfully');
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
process.once('SIGINT', () => {
  logger.info('Shutting down QuantBot (SIGINT)...');
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  logger.info('Shutting down QuantBot (SIGTERM)...');
  bot.stop('SIGTERM');
});

export { bot, serviceContainer, commandRegistry };
