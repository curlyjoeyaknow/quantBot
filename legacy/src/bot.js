"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.commandRegistry = exports.serviceContainer = exports.bot = void 0;
// -----------------------------------------------------------------------------
// 1. Imports & Bot Initialization
// -----------------------------------------------------------------------------
const telegraf_1 = require("telegraf");
const dotenv = __importStar(require("dotenv"));
const ServiceContainer_1 = require("./container/ServiceContainer");
const CommandRegistry_1 = require("./commands/CommandRegistry");
const TextWorkflowHandler_1 = require("./services/TextWorkflowHandler");
const database_1 = require("./utils/database");
const logger_1 = require("./utils/logger");
// Load environment variables
dotenv.config();
// Initialize bot (support both BOT_TOKEN and TELEGRAM_BOT_TOKEN for compatibility)
const bot = new telegraf_1.Telegraf(process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN);
exports.bot = bot;
// -----------------------------------------------------------------------------
// 2. ServiceContainer Setup
// -----------------------------------------------------------------------------
const serviceContainer = ServiceContainer_1.ServiceContainer.getInstance({ bot });
exports.serviceContainer = serviceContainer;
// -----------------------------------------------------------------------------
// 3. CommandRegistry Setup
// -----------------------------------------------------------------------------
const commandRegistry = new CommandRegistry_1.CommandRegistry(bot, serviceContainer.getService('sessionService'), serviceContainer.getService('strategyService'), serviceContainer.getService('simulationService'));
exports.commandRegistry = commandRegistry;
// -----------------------------------------------------------------------------
// 4. Text Workflow Registration
// -----------------------------------------------------------------------------
const textWorkflowHandler = new TextWorkflowHandler_1.TextWorkflowHandler(serviceContainer.getService('sessionService'), serviceContainer.getService('simulationService'), serviceContainer.getService('strategyService'), serviceContainer.getService('ichimokuWorkflowService'), serviceContainer.getService('caDetectionService'), serviceContainer.getService('repeatSimulationHelper'));
bot.on('text', async (ctx) => {
    try {
        const userId = ctx.from?.id;
        const messageText = ctx.message?.text?.substring(0, 50);
        logger_1.logger.debug('Received text message', { userId, messageText });
        await textWorkflowHandler.handleText(ctx);
    }
    catch (error) {
        logger_1.logger.error('Error handling text message', error, { userId: ctx.from?.id });
        await ctx.reply('❌ An error occurred processing your message. Please try again.');
    }
});
// Handle callback queries (button presses)
bot.on('callback_query', async (ctx) => {
    try {
        const userId = ctx.from?.id;
        const callbackData = ctx.callbackQuery?.data;
        logger_1.logger.debug('Received callback query', { userId, callbackData });
        await textWorkflowHandler.handleCallbackQuery(ctx);
    }
    catch (error) {
        logger_1.logger.error('Error handling callback query', error, { userId: ctx.from?.id });
        await ctx.answerCbQuery('❌ An error occurred. Please try again.');
    }
});
// -----------------------------------------------------------------------------
// 5. Bot Startup and Persistent Services
// -----------------------------------------------------------------------------
// Error handling
bot.catch((err, ctx) => {
    logger_1.logger.error('Bot error', err, { userId: ctx.from?.id });
    ctx.reply('❌ An error occurred. Please try again.');
});
// Start bot
(async () => {
    try {
        // Initialize database before starting bot
        logger_1.logger.info('Initializing database...');
        await (0, database_1.initDatabase)();
        logger_1.logger.info('Database initialized successfully');
        // Launch bot
        logger_1.logger.info('Launching bot...');
        await bot.launch();
        logger_1.logger.info('QuantBot started successfully');
        logger_1.logger.info('Services initialized', { healthStatus: serviceContainer.getHealthStatus() });
        // Set up Telegram bot commands menu
        logger_1.logger.info('Setting up bot commands menu...');
        await commandRegistry.setupBotCommands();
        logger_1.logger.info('Bot commands menu set up successfully');
    }
    catch (error) {
        logger_1.logger.error('Failed to start bot', error);
        process.exit(1);
    }
})();
// Graceful shutdown
process.once('SIGINT', () => {
    logger_1.logger.info('Shutting down QuantBot (SIGINT)...');
    bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
    logger_1.logger.info('Shutting down QuantBot (SIGTERM)...');
    bot.stop('SIGTERM');
});
//# sourceMappingURL=bot.js.map