/**
 * Cancel Command Handler
 * ======================
 * Handles the /cancel command for clearing user sessions.
 * Extracted from the monolithic bot.ts to improve modularity and testability.
 */

import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { SessionService } from '../services/SessionService';

export class CancelCommandHandler extends BaseCommandHandler {
  readonly command = 'cancel';
  
  constructor(private sessionService: SessionService) {
    super();
  }
  
  async execute(ctx: Context, session?: Session): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await this.sendError(ctx, 'Unable to identify user.');
      return;
    }
    
    try {
      if (this.sessionService.hasSession(userId)) {
        this.sessionService.clearSession(userId);
        await ctx.reply('✅ **Simulation cancelled!**\n\nSession cleared. Use `/backtest` to start over.');
      } else {
        await ctx.reply('❌ No active session to cancel.');
      }
    } catch (error) {
      console.error('Cancel command error:', error);
      await this.sendError(ctx, 'Failed to cancel session. Please try again.');
    }
  }
}
