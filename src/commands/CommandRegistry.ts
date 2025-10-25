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
import { SessionService, StrategyService, SimulationService } from '../services';

export class CommandRegistry {
  private handlers: Map<string, CommandHandler> = new Map();
  
  constructor(
    private sessionService: SessionService,
    private strategyService: StrategyService,
    private simulationService: SimulationService
  ) {
    this.registerDefaultHandlers();
  }
  
  /**
   * Register default command handlers
   */
  private registerDefaultHandlers(): void {
    this.register(new BacktestCommandHandler(this.sessionService));
    this.register(new StrategyCommandHandler(this.strategyService));
    this.register(new CancelCommandHandler(this.sessionService));
    this.register(new RepeatCommandHandler(this.simulationService, this.sessionService));
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
}
