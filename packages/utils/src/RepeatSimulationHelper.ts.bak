/**
 * Repeat Simulation Helper
 * =======================
 * Utility functions for repeating simulations from previous runs.
 * Extracted from bot.ts to improve modularity and reusability.
 * 
 * NOTE: This file should be moved to @quantbot/bot package as it has
 * dependencies on bot-specific types and services.
 */

import { Context } from 'telegraf';

// TODO: Move this file to @quantbot/bot package
// These imports break package independence
// import { SessionService } from '@quantbot/services';
// import { Session } from '@quantbot/bot';

export class RepeatSimulationHelper {
  constructor(private sessionService: any) {} // SessionService type from @quantbot/services
  
  /**
   * Primes a session from a previous run's parameters so user can rerun/re-edit.
   */
  async repeatSimulation(ctx: Context, run: any): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply('❌ Unable to identify user.');
      return;
    }
    
    const newSession: any = { // Session type from @quantbot/bot
      step: 'waiting_for_strategy',
      type: 'repeat',
      data: {
        mint: run.mint,
        chain: run.chain,
        datetime: run.startTime,
        metadata: { 
          name: run.token_name || run.tokenName, 
          symbol: run.token_symbol || run.tokenSymbol 
        },
        strategy: undefined,
        stopLossConfig: undefined,
        lastSimulation: {
          mint: run.mint,
          chain: run.chain,
          datetime: run.startTime,
          metadata: { 
            name: run.token_name || run.tokenName, 
            symbol: run.token_symbol || run.tokenSymbol 
          },
          candles: [],
        },
      }
    };
    
    this.sessionService.setSession(userId, newSession);

    const chainEmoji = run.chain === 'ethereum' ? '⟠' : 
                      run.chain === 'bsc' ? '🟡' : 
                      run.chain === 'base' ? '🔵' : '◎';
    
    await ctx.reply(
      `🔄 **Repeating Simulation**\n\n` +
      `${chainEmoji} Chain: ${run.chain.toUpperCase()}\n` +
      `🪙 Token: ${run.tokenName} (${run.tokenSymbol})\n` +
      `📅 Period: ${run.startTime.toFormat('yyyy-MM-dd HH:mm')} - ${run.endTime.toFormat('yyyy-MM-dd HH:mm')}\n\n` +
      `**Take Profit Strategy:**\n` +
      `• \`yes\` - Default: 50%@2x, 30%@5x, 20%@10x\n` +
      `• \`50@2x,30@5x,20@10x\` - Custom\n` +
      `• \`[{"percent":0.5,"target":2}]\` - JSON`,
      { parse_mode: 'Markdown' }
    );
  }
}
