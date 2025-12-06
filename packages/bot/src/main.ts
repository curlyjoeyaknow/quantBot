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
import { SessionService, SimulationService, StrategyService, IchimokuWorkflowService, CADetectionService, TextWorkflowHandler } from '@quantbot/services';
import { initDatabase, logger } from '@quantbot/utils';
import { RepeatSimulationHelper } from './utils/RepeatSimulationHelper';
import { SessionCleanupManager } from './utils/session-cleanup';

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
    
    // Use timeout for text handling to prevent hanging
    const { withTimeout, COMMAND_TIMEOUTS } = await import('./utils/command-helpers');
    await withTimeout(
      textWorkflowHandler.handleText(ctx),
      COMMAND_TIMEOUTS.STANDARD,
      'Text processing timed out'
    );
  } catch (error) {
    logger.error('Error handling text message', error as Error, { userId: ctx.from?.id });
    
    // Only send error if it's not a timeout (timeout errors are handled internally)
    if (error instanceof Error && !error.message.includes('timed out')) {
      try {
        await ctx.reply('❌ An error occurred processing your message. Please try again.');
      } catch (replyError) {
        logger.error('Failed to send error message', replyError as Error);
      }
    }
  }
});

// Handle callback queries (button presses)
bot.on('callback_query', async (ctx) => {
  try {
    const userId = ctx.from?.id;
    const callbackData = (ctx.callbackQuery as any)?.data;
    logger.debug('Received callback query', { userId, callbackData });
    
    // Use timeout for callback handling
    const { withTimeout, COMMAND_TIMEOUTS } = await import('./utils/command-helpers');
    await withTimeout(
      textWorkflowHandler.handleCallbackQuery(ctx),
      COMMAND_TIMEOUTS.QUICK,
      'Callback processing timed out'
    );
  } catch (error) {
    logger.error('Error handling callback query', error as Error, { userId: ctx.from?.id });
    
    try {
      await ctx.answerCbQuery('❌ An error occurred. Please try again.');
    } catch (replyError) {
      logger.error('Failed to answer callback query', replyError as Error);
    }
  }
});

// -----------------------------------------------------------------------------
// 5. Bot Startup and Persistent Services
// -----------------------------------------------------------------------------

// Error handling
bot.catch(async (err, ctx) => {
  logger.error('Bot error', err, { userId: ctx.from?.id, chatId: ctx.chat?.id });
  
  try {
    await ctx.reply('❌ An error occurred. Please try again.');
  } catch (replyError) {
    logger.error('Failed to send error message in bot.catch', replyError as Error);
  }
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
    
    // Start session cleanup manager
    const sessionCleanupManager = serviceContainer.getService<SessionCleanupManager>('sessionCleanupManager');
    logger.info('Session cleanup manager started');
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
