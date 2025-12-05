/**
 * Command Helper Utilities
 * ========================
 * Utility functions for command handlers including timeout handling,
 * input validation, and user feedback.
 */

import { Context } from 'telegraf';
import { logger } from '@quantbot/utils';

/**
 * Timeout configuration for different command types
 */
export const COMMAND_TIMEOUTS = {
  QUICK: 10_000,      // 10 seconds for quick commands
  STANDARD: 30_000,   // 30 seconds for standard commands
  LONG: 120_000,      // 2 minutes for long-running operations
  ANALYSIS: 300_000,  // 5 minutes for analysis operations
} as const;

/**
 * Execute a promise with a timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string = 'Operation timed out'
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]);
}

/**
 * Validate user input - check if user ID exists
 */
export function validateUser(ctx: Context): number | null {
  const userId = ctx.from?.id;
  if (!userId) {
    logger.warn('Command executed without user ID', {
      chatId: ctx.chat?.id,
      chatType: ctx.chat?.type,
    });
    return null;
  }
  return userId;
}

/**
 * Validate that command is executed in private chat
 */
export function validatePrivateChat(ctx: Context): boolean {
  if (ctx.chat?.type !== 'private') {
    logger.debug('Command ignored in non-private chat', {
      chatId: ctx.chat?.id,
      chatType: ctx.chat?.type,
    });
    return false;
  }
  return true;
}

/**
 * Extract command arguments from context
 */
export function extractCommandArgs(text: string, command: string): string[] {
  if (!text.startsWith(`/${command}`)) {
    return [];
  }
  
  const args = text.slice(`/${command}`.length).trim();
  return args ? args.split(/\s+/) : [];
}

/**
 * Validate token address format (basic validation)
 */
export function isValidTokenAddress(address: string, chain?: string): boolean {
  if (!address || address.length < 20) {
    return false;
  }

  // Solana addresses are base58 encoded, typically 32-44 characters
  if (!chain || chain.toLowerCase() === 'solana') {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  }

  // EVM addresses are hex encoded, 42 characters (0x + 40 hex)
  if (['ethereum', 'bsc', 'base', 'arbitrum'].includes(chain.toLowerCase())) {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }

  // Default: allow if it looks like a reasonable address
  return address.length >= 20 && address.length <= 100;
}

/**
 * Sanitize user input to prevent injection
 */
export function sanitizeInput(input: string, maxLength: number = 1000): string {
  if (!input) {
    return '';
  }
  
  // Trim and limit length
  let sanitized = input.trim().slice(0, maxLength);
  
  // Remove potentially dangerous characters for command injection
  sanitized = sanitized.replace(/[;&|`$(){}[\]]/g, '');
  
  return sanitized;
}

/**
 * Send typing indicator to show bot is processing
 */
export async function sendTyping(ctx: Context): Promise<void> {
  try {
    await ctx.telegram.sendChatAction(ctx.chat!.id, 'typing');
  } catch (error) {
    // Ignore errors for typing indicator
    logger.debug('Failed to send typing indicator', { error });
  }
}

/**
 * Send progress message with optional update
 */
export class ProgressMessage {
  private messageId?: number;
  private chatId?: number;

  constructor(private ctx: Context) {
    this.chatId = ctx.chat?.id;
  }

  async send(message: string): Promise<void> {
    try {
      const sent = await this.ctx.reply(message, { parse_mode: 'Markdown' });
      this.messageId = sent.message_id;
    } catch (error) {
      logger.error('Failed to send progress message', error as Error);
    }
  }

  async update(message: string): Promise<void> {
    if (!this.messageId || !this.chatId) {
      await this.send(message);
      return;
    }

    try {
      await this.ctx.telegram.editMessageText(
        this.chatId,
        this.messageId,
        undefined,
        message,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      // If edit fails, send new message
      logger.debug('Failed to update progress message, sending new', { error });
      await this.send(message);
    }
  }

  async delete(): Promise<void> {
    if (!this.messageId || !this.chatId) {
      return;
    }

    try {
      await this.ctx.telegram.deleteMessage(this.chatId, this.messageId);
    } catch (error) {
      logger.debug('Failed to delete progress message', { error });
    }
  }
}

/**
 * Rate limiter for commands
 */
export class CommandRateLimiter {
  private requests: Map<number, number[]> = new Map();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number = 10, windowMs: number = 60_000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  /**
   * Check if user can execute command
   */
  canExecute(userId: number): boolean {
    const now = Date.now();
    const userRequests = this.requests.get(userId) || [];
    
    // Remove old requests outside the window
    const recentRequests = userRequests.filter(
      timestamp => now - timestamp < this.windowMs
    );
    
    // Check if limit exceeded
    if (recentRequests.length >= this.maxRequests) {
      return false;
    }
    
    // Record this request
    recentRequests.push(now);
    this.requests.set(userId, recentRequests);
    
    return true;
  }

  /**
   * Get time until next request is allowed
   */
  getTimeUntilNext(userId: number): number {
    const now = Date.now();
    const userRequests = this.requests.get(userId) || [];
    const recentRequests = userRequests.filter(
      timestamp => now - timestamp < this.windowMs
    );
    
    if (recentRequests.length < this.maxRequests) {
      return 0;
    }
    
    // Find oldest request in window
    const oldestRequest = Math.min(...recentRequests);
    return this.windowMs - (now - oldestRequest);
  }

  /**
   * Clean up old entries (call periodically)
   */
  cleanup(): void {
    const now = Date.now();
    for (const [userId, requests] of this.requests.entries()) {
      const recentRequests = requests.filter(
        timestamp => now - timestamp < this.windowMs
      );
      
      if (recentRequests.length === 0) {
        this.requests.delete(userId);
      } else {
        this.requests.set(userId, recentRequests);
      }
    }
  }
}

// Global rate limiter instance
export const commandRateLimiter = new CommandRateLimiter(10, 60_000);

// Cleanup old entries every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    commandRateLimiter.cleanup();
  }, 5 * 60_000);
}

