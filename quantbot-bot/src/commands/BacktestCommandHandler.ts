/**
 * Backtest Command Handler
 * =======================
 * Handles the /backtest command for starting new simulation workflows.
 * Extracted from the monolithic bot.ts to improve modularity and testability.
 */

import { Context, Markup } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { SessionService } from '../services/SessionService';
import { eventBus, EventFactory } from '../events';
import { getUserSimulationRuns } from '../database/client';
import { getRecentCalls, getCallerStats } from '../utils/caller-database';
import { logger } from '../utils/logger';

export class BacktestCommandHandler extends BaseCommandHandler {
  readonly command = 'backtest';
  
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
      // Initialize session for backtest workflow
      const newSession: Session = {
        step: 'selecting_source',
        type: 'backtest',
        data: {}
      };
      
      // Store session using SessionService
      this.sessionService.setSession(userId, newSession);
      
      // Emit user session started event
      await eventBus.publish(EventFactory.createUserEvent(
        'user.session.started',
        { sessionData: newSession },
        'BacktestCommandHandler',
        userId
      ));
      
      // Emit command executed event
      await eventBus.publish(EventFactory.createUserEvent(
        'user.command.executed',
        { command: 'backtest', success: true },
        'BacktestCommandHandler',
        userId
      ));
      
      // Show menu with Mini App option
      const miniAppUrl = process.env.MINI_APP_URL || 'https://your-domain.com/miniapp?view=backtest';
      
      await ctx.reply(
        '🤖 **QuantBot - Backtest Mode**\n\n' +
        '**Choose how you want to start your backtest:**',
        Markup.inlineKeyboard([
          [Markup.button.webApp('📱 Open Mini App', miniAppUrl)],
          [Markup.button.callback('📊 Recent Backtests', 'backtest_source:recent_backtests')],
          [Markup.button.callback('📞 Recent Calls', 'backtest_source:recent_calls')],
          [Markup.button.callback('👤 Calls by Caller', 'backtest_source:by_caller')],
          [Markup.button.callback('✍️ Manual Mint Entry', 'backtest_source:manual')]
        ])
      );
      
    } catch (error) {
      logger.error('Backtest command error', error as Error, { userId });
      
      // Emit command failed event
      await eventBus.publish(EventFactory.createUserEvent(
        'user.command.failed',
        { command: 'backtest', success: false, error: error instanceof Error ? error.message : String(error) },
        'BacktestCommandHandler',
        userId
      ));
      
      await this.sendError(ctx, 'Failed to initialize backtest session. Please try again.');
    }
  }
}
