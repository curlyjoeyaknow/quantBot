/**
 * Cancel Command Handler
 * ======================
 * Handles the /cancel command for clearing user sessions.
 * Extracted from the monolithic bot.ts to improve modularity and testability.
 */

import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { SessionService } from '../services/SessionService';
import { eventBus, EventFactory } from '../events';
import { logger } from '../utils/logger';

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
        const session = this.sessionService.getSession(userId);
        this.sessionService.clearSession(userId);
        
        // Emit session cleared event
        await eventBus.publish(EventFactory.createUserEvent(
          'user.session.cleared',
          { sessionData: session },
          'CancelCommandHandler',
          userId
        ));
        
        // Emit command executed event
        await eventBus.publish(EventFactory.createUserEvent(
          'user.command.executed',
          { command: 'cancel', success: true },
          'CancelCommandHandler',
          userId
        ));
        
        await ctx.reply('✅ **Simulation cancelled!**\n\nSession cleared. Use `/backtest` to start over.');
      } else {
        await ctx.reply('❌ No active session to cancel.');
      }
    } catch (error) {
      logger.error('Cancel command error', error as Error, { userId });
      
      // Emit command failed event
      await eventBus.publish(EventFactory.createUserEvent(
        'user.command.failed',
        { command: 'cancel', success: false, error: error instanceof Error ? error.message : String(error) },
        'CancelCommandHandler',
        userId
      ));
      
      await this.sendError(ctx, 'Failed to cancel session. Please try again.');
    }
  }
}
