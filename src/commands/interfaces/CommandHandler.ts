/**
 * Command Handler Interface
 * ========================
 * Defines the contract for all command handlers in the QuantBot system.
 * This interface enables consistent command processing and makes the system
 * more testable and maintainable.
 */

import { Context } from 'telegraf';

/**
 * Session data structure for maintaining user state
 */
export interface Session {
  step?: string;
  type?: string;
  data?: any;
  mint?: string;
  chain?: string;
  datetime?: any; // DateTime from luxon
  metadata?: any;
  strategy?: any[];
  stopLossConfig?: any;
  entryConfig?: any;
  reEntryConfig?: any;
  lastSimulation?: {
    mint: string;
    chain: string;
    datetime: any;
    metadata: any;
    candles: any[];
  };
  waitingForRunSelection?: boolean;
  recentRuns?: any[];
}

/**
 * Base interface for all command handlers
 */
export interface CommandHandler {
  /**
   * The command name (e.g., 'backtest', 'strategy')
   */
  readonly command: string;
  
  /**
   * Execute the command with the given context and session
   * @param ctx - Telegram bot context
   * @param session - Current user session (may be undefined for new users)
   * @returns Promise that resolves when command execution is complete
   */
  execute(ctx: Context, session?: Session): Promise<void>;
}

/**
 * Base class for command handlers with common functionality
 */
export abstract class BaseCommandHandler implements CommandHandler {
  abstract readonly command: string;
  
  /**
   * Get or create a session for the user
   */
  protected getOrCreateSession(userId: number, sessions: Record<number, Session>): Session {
    if (!sessions[userId]) {
      sessions[userId] = {};
    }
    return sessions[userId];
  }
  
  /**
   * Clear a user's session
   */
  protected clearSession(userId: number, sessions: Record<number, Session>): void {
    delete sessions[userId];
  }
  
  /**
   * Send a formatted error message
   */
  protected async sendError(ctx: Context, message: string): Promise<void> {
    await ctx.reply(`❌ **Error**\n\n${message}`, { parse_mode: 'Markdown' });
  }
  
  /**
   * Send a formatted success message
   */
  protected async sendSuccess(ctx: Context, message: string): Promise<void> {
    await ctx.reply(`✅ **Success**\n\n${message}`, { parse_mode: 'Markdown' });
  }
  
  /**
   * Send a formatted info message
   */
  protected async sendInfo(ctx: Context, message: string): Promise<void> {
    await ctx.reply(`ℹ️ **Info**\n\n${message}`, { parse_mode: 'Markdown' });
  }
  
  abstract execute(ctx: Context, session?: Session): Promise<void>;
}
