/**
 * Command Registry
 * ================
 * Manages registration and execution of command handlers.
 * Provides a centralized way to register and execute commands.
 */
import { Context, Telegraf } from 'telegraf';
import { CommandHandler } from './interfaces/CommandHandler';
import { SessionService } from '../services/SessionService';
import { StrategyService } from '../services/StrategyService';
import { SimulationService } from '../services/SimulationService';
export declare class CommandRegistry {
    private handlers;
    private bot;
    private sessionService;
    private strategyService;
    private simulationService;
    constructor(bot: Telegraf, sessionService: SessionService, strategyService: StrategyService, simulationService: SimulationService);
    /**
     * Register default command handlers
     */
    private registerDefaultHandlers;
    /**
     * Set up Telegram bot commands menu
     * This registers all commands in the Telegram menu for easy access
     */
    setupBotCommands(): Promise<void>;
    /**
     * Register a command handler
     */
    private register;
    /**
     * Execute a command
     */
    execute(command: string, ctx: Context): Promise<void>;
    /**
     * Get all registered commands
     */
    getCommands(): string[];
    /**
     * Check if a command is registered
     */
    hasCommand(command: string): boolean;
    getHandler(commandName: string): CommandHandler | undefined;
}
//# sourceMappingURL=CommandRegistry.d.ts.map