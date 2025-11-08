/**
 * Backtest Command Handler
 * =======================
 * Handles the /backtest command for starting new simulation workflows.
 * Extracted from the monolithic bot.ts to improve modularity and testability.
 */

import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { SessionService } from '../services/SessionService';
import { eventBus, EventFactory } from '../events';

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
        step: 'waiting_for_token',
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
      
      await ctx.reply(
        '🤖 **QuantBot - Backtest Mode**\n\n' +
        'Paste a token address (Solana or EVM) to begin your simulation.\n\n' +
        '**📋 What happens next:**\n' +
        '1. I\'ll fetch historical price data for the token\n' +
        '2. You\'ll configure your trading strategy\n' +
        '3. I\'ll simulate the strategy and show results\n\n' +
        '**✨ Smart Features:**\n' +
        '• If this token has been called before, I\'ll use the original call timestamp\n' +
        '• Multi-chain support: Solana, Ethereum, BSC, Base, Arbitrum\n' +
        '• Customizable profit targets and stop-loss settings\n\n' +
        '**💡 Related Commands:**\n' +
        '• `/calls <token>` - Show all historical calls for a token\n' +
        '• `/callers` - Show top callers statistics\n' +
        '• `/recent` - Show recent CA calls\n' +
        '• `/strategy` - Manage custom trading strategies\n\n' +
        '**📝 Next Step:** Paste your token address in the next message.',
        { parse_mode: 'Markdown' }
      );
      
    } catch (error) {
      console.error('Backtest command error:', error);
      
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
