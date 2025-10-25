/**
 * Ichimoku Command Handler
 * =========================
 * Handles the /ichimoku command for Ichimoku cloud analysis
 */

import { Context } from 'telegraf';
import { BaseCommandHandler } from './interfaces/CommandHandler';
import { Session } from './interfaces/CommandHandler';
import { IchimokuService } from '../services/IchimokuService';

export class IchimokuCommandHandler extends BaseCommandHandler {
  readonly command = 'ichimoku';

  constructor(private ichimokuService: IchimokuService) {
    super();
  }

  async execute(ctx: Context, session?: Session): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply('❌ Unable to identify user');
      return;
    }

    console.log(`[DEBUG] /ichimoku command triggered by user ${userId}`);
    
    // Clear any existing session to prevent conflicts
    if (session) {
      Object.keys(session).forEach(key => delete session[key]);
    }
    
    // Initialize Ichimoku session
    const ichimokuSession: Session = { 
      step: 'waiting_for_mint',
      type: 'ichimoku',
      data: {}
    };

    // Copy session data to the provided session object
    if (session) {
      Object.assign(session, ichimokuSession);
    }
    
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
  }
}