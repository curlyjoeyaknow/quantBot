/**
 * Ichimoku Command Handler
 * ========================
 * Handles the /ichimoku command for initiating Ichimoku Cloud analysis
 * and monitoring workflows.
 */

import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { SessionService } from '../services/SessionService';
import { logger } from '../utils/logger';

export class IchimokuCommandHandler extends BaseCommandHandler {
  readonly command = 'ichimoku';
  
  constructor(private sessionService: SessionService) {
    super();
  }
  
  async execute(ctx: Context, session?: Session): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await this.sendError(ctx, 'Unable to identify user.');
      return;
    }
    
    logger.debug('/ichimoku command triggered', { userId });
    
    try {
      // Clear any existing session to prevent conflicts
      this.sessionService.clearSession(userId);
      
      // Initialize Ichimoku session
      const newSession: Session = {
        step: 'waiting_for_mint',
        type: 'ichimoku',
        data: {}
      };
      
      this.sessionService.setSession(userId, newSession);
      
      await ctx.reply(
        '📈 **Ichimoku Cloud Analysis**\n\n' +
        'Paste the token address (Solana or EVM) to start Ichimoku monitoring.\n\n' +
        'The bot will:\n' +
        '• Fetch 52 historical 5-minute candles from Birdeye\n' +
        '• Calculate Ichimoku Cloud components\n' +
        '• Start real-time price monitoring\n' +
        '• Send alerts for Ichimoku signals\n\n' +
        'Type `/cancel` to abort.',
        { parse_mode: 'Markdown' }
      );
      
    } catch (error) {
      logger.error('Ichimoku command error', error as Error, { userId });
      await this.sendError(ctx, 'Failed to initialize Ichimoku analysis. Please try again.');
    }
  }
}
