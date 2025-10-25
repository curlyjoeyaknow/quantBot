/**
 * Command Registry
 * ================
 * Manages registration and execution of command handlers.
 * Provides a centralized way to register and execute commands.
 */

import { Context } from 'telegraf';
import { CommandHandler } from './interfaces/CommandHandler';
import { BacktestCommandHandler } from './BacktestCommandHandler';
import { StrategyCommandHandler } from './StrategyCommandHandler';
import { CancelCommandHandler } from './CancelCommandHandler';
import { RepeatCommandHandler } from './RepeatCommandHandler';
import { ExtractCommandHandler } from './ExtractCommandHandler';
import { AnalysisCommandHandler } from './AnalysisCommandHandler';
import { HistoryCommandHandler } from './HistoryCommandHandler';
import { BacktestCallCommandHandler } from './BacktestCallCommandHandler';
import { IchimokuCommandHandler } from './IchimokuCommandHandler';
import { AlertCommandHandler } from './AlertCommandHandler';
import { AlertsCommandHandler } from './AlertsCommandHandler';
import { ServiceContainer } from '../services/ServiceContainer';

export class CommandRegistry {
  private handlers: Map<string, CommandHandler> = new Map();
  
  constructor(private serviceContainer: ServiceContainer) {
    this.registerDefaultHandlers();
  }
  
  /**
   * Register default command handlers
   */
  private registerDefaultHandlers(): void {
    const sessionService = this.serviceContainer.getSessionService();
    const strategyService = this.serviceContainer.getStrategyService();
    const simulationService = this.serviceContainer.getSimulationService();
    const caService = this.serviceContainer.getCAService();
    const ichimokuService = this.serviceContainer.getIchimokuService();
    
    this.register(new BacktestCommandHandler(sessionService));
    this.register(new StrategyCommandHandler(strategyService));
    this.register(new CancelCommandHandler(sessionService));
    this.register(new RepeatCommandHandler(simulationService, sessionService));
    this.register(new ExtractCommandHandler());
    this.register(new AnalysisCommandHandler());
    this.register(new HistoryCommandHandler(simulationService));
    this.register(new BacktestCallCommandHandler(simulationService));
    this.register(new IchimokuCommandHandler(ichimokuService));
    this.register(new AlertCommandHandler(caService));
    this.register(new AlertsCommandHandler(caService));
  }
  
  /**
   * Register a command handler
   */
  register(handler: CommandHandler): void {
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
    const sessionService = this.serviceContainer.getSessionService();
    const session = userId ? sessionService.getSession(userId) : undefined;
    
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
}
