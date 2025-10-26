/**
 * Command Registry
 * ================
 * Manages registration and execution of command handlers.
 * Provides a centralized way to register and execute commands.
 */

import { Context, Telegraf } from 'telegraf';
import { CommandHandler, Session } from './interfaces/CommandHandler';
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
import { SessionService } from '../services/SessionService';
import { StrategyService } from '../services/StrategyService';
import { SimulationService } from '../services/SimulationService';
import { RepeatSimulationHelper } from '../utils/RepeatSimulationHelper';

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
    
    // Register handlers with the bot
    this.handlers.forEach((handler, commandName) => {
      this.bot.command(commandName, async (ctx) => {
        const userId = ctx.from?.id;
        const session = userId ? this.sessionService.getSession(userId) : undefined;
        await handler.execute(ctx, session);
      });
    });
    
    console.log(`Registered ${this.handlers.size} command handlers.`);
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
      console.warn(`No handler found for command: ${command}`);
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
