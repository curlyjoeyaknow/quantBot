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
  await textWorkflowHandler.handleText(ctx);
});

// -----------------------------------------------------------------------------
// 5. Bot Startup and Persistent Services
// -----------------------------------------------------------------------------

// Error handling
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
  ctx.reply('❌ An error occurred. Please try again.');
});

// Start bot
bot.launch().then(async () => {
  console.log('🤖 QuantBot started successfully!');
  console.log('📊 Services initialized:', serviceContainer.getHealthStatus());
  
  // Set up Telegram bot commands menu
  await commandRegistry.setupBotCommands();
}).catch((error) => {
  console.error('Failed to start bot:', error);
  process.exit(1);
});

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('🛑 Shutting down QuantBot...');
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  console.log('🛑 Shutting down QuantBot...');
  bot.stop('SIGTERM');
});

export { bot, serviceContainer, commandRegistry };
