/**
 * Backtest Command Handler
 * =======================
 * Handles the /backtest command for starting new simulation workflows.
 * Extracted from the monolithic bot.ts to improve modularity and testability.
 */

import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { SimulationService } from '../services/interfaces/ServiceInterfaces';

export class BacktestCommandHandler extends BaseCommandHandler {
  readonly command = 'backtest';
  
  constructor(private simulationService: SimulationService) {
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
      
      // Store session (this would be injected via SessionService in real implementation)
      // For now, we'll handle this in the main bot file
      
      await ctx.reply(
        '🤖 **QuantBot Ready!**\n\n' +
        'Please provide the token address (Solana or EVM) to start the simulation.\n\n' +
        '**Supported formats:**\n' +
        '• Solana: `So11111111111111111111111111111111111111112`\n' +
        '• Ethereum: `0x1234567890123456789012345678901234567890`\n' +
        '• BSC: `0x1234567890123456789012345678901234567890`\n' +
        '• Base: `0x1234567890123456789012345678901234567890`\n\n' +
        'Type `/cancel` to abort.',
        { parse_mode: 'Markdown' }
      );
      
    } catch (error) {
      console.error('Backtest command error:', error);
      await this.sendError(ctx, 'Failed to initialize backtest session. Please try again.');
    }
  }
}
