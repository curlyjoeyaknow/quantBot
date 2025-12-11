/**
 * Command Registry
 * ================
 * Manages registration and execution of command handlers.
 * Provides a centralized way to register and execute commands.
 */

import { Context, Telegraf } from 'telegraf';
import { CommandHandler, Session, BaseCommandHandler } from './interfaces/CommandHandler';
import { BacktestCommandHandler } from './BacktestCommandHandler';
import { StrategyCommandHandler } from './StrategyCommandHandler';
import { CancelCommandHandler } from './CancelCommandHandler';
import { RepeatCommandHandler } from './RepeatCommandHandler';
import { CallsCommandHandler } from './CallsCommandHandler';
import { CallersCommandHandler } from './CallersCommandHandler';
import { RecentCommandHandler } from './RecentCommandHandler';
import { ExtractCommandHandler } from './ExtractCommandHandler';
import { AnalysisCommandHandler } from './AnalysisCommandHandler';
import { HistoryCommandHandler } from './HistoryCommandHandler';
import { BacktestCallCommandHandler } from './BacktestCallCommandHandler';
import { IchimokuCommandHandler } from './IchimokuCommandHandler';
import { AlertCommandHandler } from './AlertCommandHandler';
import { AlertsCommandHandler } from './AlertsCommandHandler';
import { MonitorCommandHandler } from './MonitorCommandHandler';
import { BeginCommandHandler } from './BeginCommandHandler';
import { OptionsCommandHandler } from './OptionsCommandHandler';
import { LiveTradeCommandHandler } from './LiveTradeCommandHandler';
// import { AddCurlyJoeCommandHandler } from './AddCurlyJoeCommandHandler';
// import { WatchlistCommandHandler } from './WatchlistCommandHandler';
import { SessionService, StrategyService, SimulationService } from '@quantbot/services';
import { RepeatSimulationHelper } from '../utils/RepeatSimulationHelper';
import { logger } from '@quantbot/utils';

export class CommandRegistry {
  private handlers: Map<string, CommandHandler> = new Map();
  private bot: Telegraf;
  private sessionService: SessionService;
  private strategyService: StrategyService;
  private simulationService: SimulationService;
  
  constructor(
    bot: Telegraf,
    sessionService: SessionService,
    strategyService: StrategyService,
    simulationService: SimulationService
  ) {
    this.bot = bot;
    this.sessionService = sessionService;
    this.strategyService = strategyService;
    this.simulationService = simulationService;
    this.registerDefaultHandlers();
  }
  
  /**
   * Register default command handlers
   */
  private registerDefaultHandlers(): void {
    // Register utility commands first
    this.register(new BeginCommandHandler());
    this.register(new OptionsCommandHandler());
    
    // Register core command handlers
    this.register(new BacktestCommandHandler(this.sessionService));
    this.register(new StrategyCommandHandler(this.strategyService));
    this.register(new CancelCommandHandler(this.sessionService));
    
    // Register repeat handler with RepeatSimulationHelper
    const repeatHelper = new RepeatSimulationHelper(this.sessionService);
    this.register(new RepeatCommandHandler(this.simulationService, this.sessionService, repeatHelper));
    
    // Register analysis command handlers
    this.register(new CallsCommandHandler());
    this.register(new CallersCommandHandler());
    this.register(new RecentCommandHandler());
    
    // Register data extraction and analysis handlers
    this.register(new ExtractCommandHandler());
    this.register(new AnalysisCommandHandler());
    this.register(new HistoryCommandHandler());
    this.register(new BacktestCallCommandHandler(this.sessionService, this.simulationService));
    this.register(new IchimokuCommandHandler(this.sessionService));
    this.register(new AlertCommandHandler());
    this.register(new AlertsCommandHandler(this.sessionService));
    // Monitor command depends on monitoring package wiring; temporarily disabled until service is wired
    // this.register(new MonitorCommandHandler());
    // Live trade handler requires trading config service; temporarily disabled until service wiring is added
    // this.register(new LiveTradeCommandHandler());
    // CurlyJoe handler depends on monitoring/ingestion wiring; disabled for now
    // this.register(new AddCurlyJoeCommandHandler());
    // Watchlist handler depends on monitored-tokens DB wiring; disabled for now
    // this.register(new WatchlistCommandHandler());
    
    // Register handlers with the bot
    this.handlers.forEach((handler, commandName) => {
      this.bot.command(commandName, async (ctx) => {
        try {
          // Use executeWithValidation if available (BaseCommandHandler)
          if (handler instanceof BaseCommandHandler) {
            const session = ctx.from?.id 
              ? this.sessionService.getSession(ctx.from.id) 
              : undefined;
            await handler.executeWithValidation(ctx, session);
          } else {
            // Fallback for handlers that don't extend BaseCommandHandler
            if (ctx.chat?.type !== 'private') {
              return;
            }
            const userId = ctx.from?.id;
            const session = userId ? this.sessionService.getSession(userId) : undefined;
            await handler.execute(ctx, session);
          }
        } catch (error) {
          logger.error('Command execution error', error as Error, {
            command: commandName,
            userId: ctx.from?.id,
            chatId: ctx.chat?.id,
          });
          
          // Try to send error message if possible
          try {
            await ctx.reply('❌ An error occurred while processing your command. Please try again.');
          } catch (replyError) {
            logger.error('Failed to send error message to user', replyError as Error);
          }
        }
      });
    });
    
    logger.info(`Registered ${this.handlers.size} command handlers`);
  }
  
  /**
   * Set up Telegram bot commands menu
   * This registers all commands in the Telegram menu for easy access
   */
  async setupBotCommands(): Promise<void> {
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
      logger.info('Registered commands in Telegram menu', { commandCount: commands.length });
    } catch (error) {
      logger.error('Failed to set bot commands', error as Error);
    }
  }
  
  /**
   * Register a command handler
   */
  private register(handler: CommandHandler): void {
    this.handlers.set(handler.command, handler);
  }
  
  /**
   * Execute a command
   */
  async execute(command: string, ctx: Context): Promise<void> {
    const handler = this.handlers.get(command);
    if (!handler) {
      logger.warn('No handler found for command', { command });
      return;
    }
    
    const userId = ctx.from?.id;
    const session = userId ? this.sessionService.getSession(userId) : undefined;
    
    await handler.execute(ctx, session);
  }
  
  /**
   * Get all registered commands
   */
  getCommands(): string[] {
    return Array.from(this.handlers.keys());
  }
  
  /**
   * Check if a command is registered
   */
  hasCommand(command: string): boolean {
    return this.handlers.has(command);
  }
  
  public getHandler(commandName: string): CommandHandler | undefined {
    return this.handlers.get(commandName);
  }
}
