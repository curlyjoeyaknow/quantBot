"use strict";
/**
 * Command Registry
 * ================
 * Manages registration and execution of command handlers.
 * Provides a centralized way to register and execute commands.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommandRegistry = void 0;
const BacktestCommandHandler_1 = require("./BacktestCommandHandler");
const StrategyCommandHandler_1 = require("./StrategyCommandHandler");
const CancelCommandHandler_1 = require("./CancelCommandHandler");
const RepeatCommandHandler_1 = require("./RepeatCommandHandler");
const CallsCommandHandler_1 = require("./CallsCommandHandler");
const CallersCommandHandler_1 = require("./CallersCommandHandler");
const RecentCommandHandler_1 = require("./RecentCommandHandler");
const ExtractCommandHandler_1 = require("./ExtractCommandHandler");
const AnalysisCommandHandler_1 = require("./AnalysisCommandHandler");
const HistoryCommandHandler_1 = require("./HistoryCommandHandler");
const BacktestCallCommandHandler_1 = require("./BacktestCallCommandHandler");
const IchimokuCommandHandler_1 = require("./IchimokuCommandHandler");
const AlertCommandHandler_1 = require("./AlertCommandHandler");
const AlertsCommandHandler_1 = require("./AlertsCommandHandler");
const MonitorCommandHandler_1 = require("./MonitorCommandHandler");
const BeginCommandHandler_1 = require("./BeginCommandHandler");
const OptionsCommandHandler_1 = require("./OptionsCommandHandler");
const LiveTradeCommandHandler_1 = require("./LiveTradeCommandHandler");
const AddCurlyJoeCommandHandler_1 = require("./AddCurlyJoeCommandHandler");
const WatchlistCommandHandler_1 = require("./WatchlistCommandHandler");
const RepeatSimulationHelper_1 = require("../utils/RepeatSimulationHelper");
const logger_1 = require("../utils/logger");
class CommandRegistry {
    constructor(bot, sessionService, strategyService, simulationService) {
        this.handlers = new Map();
        this.bot = bot;
        this.sessionService = sessionService;
        this.strategyService = strategyService;
        this.simulationService = simulationService;
        this.registerDefaultHandlers();
    }
    /**
     * Register default command handlers
     */
    registerDefaultHandlers() {
        // Register utility commands first
        this.register(new BeginCommandHandler_1.BeginCommandHandler());
        this.register(new OptionsCommandHandler_1.OptionsCommandHandler());
        // Register core command handlers
        this.register(new BacktestCommandHandler_1.BacktestCommandHandler(this.sessionService));
        this.register(new StrategyCommandHandler_1.StrategyCommandHandler(this.strategyService));
        this.register(new CancelCommandHandler_1.CancelCommandHandler(this.sessionService));
        // Register repeat handler with RepeatSimulationHelper
        const repeatHelper = new RepeatSimulationHelper_1.RepeatSimulationHelper(this.sessionService);
        this.register(new RepeatCommandHandler_1.RepeatCommandHandler(this.simulationService, this.sessionService, repeatHelper));
        // Register analysis command handlers
        this.register(new CallsCommandHandler_1.CallsCommandHandler());
        this.register(new CallersCommandHandler_1.CallersCommandHandler());
        this.register(new RecentCommandHandler_1.RecentCommandHandler());
        // Register data extraction and analysis handlers
        this.register(new ExtractCommandHandler_1.ExtractCommandHandler());
        this.register(new AnalysisCommandHandler_1.AnalysisCommandHandler());
        this.register(new HistoryCommandHandler_1.HistoryCommandHandler());
        this.register(new BacktestCallCommandHandler_1.BacktestCallCommandHandler(this.sessionService, this.simulationService));
        this.register(new IchimokuCommandHandler_1.IchimokuCommandHandler(this.sessionService));
        this.register(new AlertCommandHandler_1.AlertCommandHandler());
        this.register(new AlertsCommandHandler_1.AlertsCommandHandler(this.sessionService));
        this.register(new MonitorCommandHandler_1.MonitorCommandHandler());
        this.register(new LiveTradeCommandHandler_1.LiveTradeCommandHandler());
        this.register(new AddCurlyJoeCommandHandler_1.AddCurlyJoeCommandHandler());
        this.register(new WatchlistCommandHandler_1.WatchlistCommandHandler());
        // Register handlers with the bot
        this.handlers.forEach((handler, commandName) => {
            this.bot.command(commandName, async (ctx) => {
                // Only respond to direct messages (private chats), ignore group/channel messages
                if (ctx.chat?.type !== 'private') {
                    return;
                }
                const userId = ctx.from?.id;
                const session = userId ? this.sessionService.getSession(userId) : undefined;
                await handler.execute(ctx, session);
            });
        });
        logger_1.logger.info(`Registered ${this.handlers.size} command handlers`);
    }
    /**
     * Set up Telegram bot commands menu
     * This registers all commands in the Telegram menu for easy access
     */
    async setupBotCommands() {
        const commands = [
            { command: 'begin', description: 'Welcome message and bot introduction' },
            { command: 'options', description: 'Show all available commands' },
            { command: 'backtest', description: 'Start a new PNL simulation' },
            { command: 'repeat', description: 'Repeat a previous simulation' },
            { command: 'strategy', description: 'Manage custom trading strategies' },
            { command: 'cancel', description: 'Cancel current simulation session' },
            { command: 'ichimoku', description: 'Start Ichimoku Cloud analysis' },
            { command: 'calls', description: 'Show historical calls for a token' },
            { command: 'callers', description: 'Show top callers statistics' },
            { command: 'recent', description: 'Show recent CA calls' },
            { command: 'analysis', description: 'Run comprehensive historical analysis' },
            { command: 'history', description: 'View simulation history' },
            { command: 'alerts', description: 'View active alerts and monitoring' },
            { command: 'livetrade', description: 'Manage live trade entry alerts' },
            { command: 'addcurlyjoe', description: 'Add recent CurlyJoe calls to live monitoring' },
            { command: 'watchlist', description: 'View and manage your watchlist of monitored tokens' },
        ];
        try {
            await this.bot.telegram.setMyCommands(commands);
            logger_1.logger.info('Registered commands in Telegram menu', { commandCount: commands.length });
        }
        catch (error) {
            logger_1.logger.error('Failed to set bot commands', error);
        }
    }
    /**
     * Register a command handler
     */
    register(handler) {
        this.handlers.set(handler.command, handler);
    }
    /**
     * Execute a command
     */
    async execute(command, ctx) {
        const handler = this.handlers.get(command);
        if (!handler) {
            logger_1.logger.warn('No handler found for command', { command });
            return;
        }
        const userId = ctx.from?.id;
        const session = userId ? this.sessionService.getSession(userId) : undefined;
        await handler.execute(ctx, session);
    }
    /**
     * Get all registered commands
     */
    getCommands() {
        return Array.from(this.handlers.keys());
    }
    /**
     * Check if a command is registered
     */
    hasCommand(command) {
        return this.handlers.has(command);
    }
    getHandler(commandName) {
        return this.handlers.get(commandName);
    }
}
exports.CommandRegistry = CommandRegistry;
//# sourceMappingURL=CommandRegistry.js.map