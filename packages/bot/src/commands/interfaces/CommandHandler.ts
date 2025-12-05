/**
 * Command Handler Interface
 * ========================
 * Defines the contract for all command handlers in the QuantBot system.
 * This interface enables consistent command processing and makes the system
 * more testable and maintainable.
 */

import { Context } from 'telegraf';
import { Session as SessionType } from '../../types/session';
import { logger } from '@quantbot/utils';
import { 
  validateUser, 
  validatePrivateChat, 
  withTimeout, 
  COMMAND_TIMEOUTS,
  commandRateLimiter,
  sendTyping,
  ProgressMessage
} from '../utils/command-helpers';
import { handleError } from '@quantbot/utils';

/**
 * Session data structure for maintaining user state
 * Re-export from types/session.ts for backward compatibility
 */
export type Session = SessionType;

/**
 * Command execution options
 */
export interface CommandExecutionOptions {
  timeout?: number;
  requirePrivateChat?: boolean;
  rateLimit?: boolean;
  showTyping?: boolean;
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
  
  /**
   * Get command execution options (optional)
   */
  getExecutionOptions?(): CommandExecutionOptions;
}

/**
 * Base class for command handlers with common functionality
 */
export abstract class BaseCommandHandler implements CommandHandler {
  abstract readonly command: string;
  
  /**
   * Default execution options
   */
  protected defaultOptions: CommandExecutionOptions = {
    timeout: COMMAND_TIMEOUTS.STANDARD,
    requirePrivateChat: true,
    rateLimit: true,
    showTyping: true,
  };
  
  /**
   * Get execution options for this command
   */
  getExecutionOptions(): CommandExecutionOptions {
    return this.defaultOptions;
  }
  
  /**
   * Wrapper for execute that adds validation, rate limiting, and error handling
   */
  async executeWithValidation(ctx: Context, session?: Session): Promise<void> {
    const options = this.getExecutionOptions();
    const userId = validateUser(ctx);
    
    if (!userId) {
      await this.sendError(ctx, 'Unable to identify user. Please try again.');
      return;
    }
    
    // Validate private chat if required
    if (options.requirePrivateChat !== false && !validatePrivateChat(ctx)) {
      return; // Silently ignore non-private chats
    }
    
    // Check rate limiting
    if (options.rateLimit !== false) {
      if (!commandRateLimiter.canExecute(userId)) {
        const waitTime = commandRateLimiter.getTimeUntilNext(userId);
        const waitSeconds = Math.ceil(waitTime / 1000);
        await this.sendError(
          ctx,
          `⏱️ Rate limit exceeded. Please wait ${waitSeconds} second${waitSeconds !== 1 ? 's' : ''} before trying again.`
        );
        return;
      }
    }
    
    // Show typing indicator
    if (options.showTyping !== false) {
      await sendTyping(ctx);
    }
    
    // Execute with timeout
    const timeout = options.timeout || COMMAND_TIMEOUTS.STANDARD;
    
    try {
      await withTimeout(
        this.execute(ctx, session),
        timeout,
        `Command execution timed out after ${timeout / 1000} seconds`
      );
    } catch (error) {
      const errorResult = handleError(error, {
        userId,
        command: this.command,
        chatId: ctx.chat?.id,
      });
      
      // Send user-friendly error message
      if (error instanceof Error && error.message.includes('timed out')) {
        await this.sendError(
          ctx,
          `⏱️ This operation is taking longer than expected. Please try again or use a simpler query.`
        );
      } else {
        await this.sendError(
          ctx,
          '❌ An error occurred while processing your command. Please try again later.'
        );
      }
      
      // Re-throw to allow caller to handle if needed
      throw error;
    }
  }
  
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
    try {
      await ctx.reply(`❌ **Error**\n\n${message}`, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Failed to send error message', error as Error, {
        userId: ctx.from?.id,
        message,
      });
    }
  }
  
  /**
   * Send a formatted success message
   */
  protected async sendSuccess(ctx: Context, message: string): Promise<void> {
    try {
      await ctx.reply(`✅ **Success**\n\n${message}`, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Failed to send success message', error as Error, {
        userId: ctx.from?.id,
        message,
      });
    }
  }
  
  /**
   * Send a formatted info message
   */
  protected async sendInfo(ctx: Context, message: string): Promise<void> {
    try {
      await ctx.reply(`ℹ️ **Info**\n\n${message}`, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Failed to send info message', error as Error, {
        userId: ctx.from?.id,
        message,
      });
    }
  }
  
  /**
   * Create a progress message helper
   */
  protected createProgressMessage(ctx: Context): ProgressMessage {
    return new ProgressMessage(ctx);
  }
  
  abstract execute(ctx: Context, session?: Session): Promise<void>;
}
