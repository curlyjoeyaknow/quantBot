/**
 * Calls Command Handler
 * =====================
 * Handles the /calls command for showing all calls for a specific token.
 */

import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { findCallsForToken } from '../utils/caller-database';

export class CallsCommandHandler extends BaseCommandHandler {
  readonly command = 'calls';
  
  async execute(ctx: Context, session?: Session): Promise<void> {
    const message = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    
    // Extract mint address from command
    const parts = message.split(' ');
    if (parts.length < 2) {
      await this.sendError(ctx, '**Usage:** `/calls <mint_address>`\n\nExample: `/calls So11111111111111111111111111111111111111112`');
      return;
    }
    
    const mint = parts[1];
    
    try {
      await ctx.reply('🔍 **Searching for calls...**');
      
      const calls = await findCallsForToken(mint);
      
      if (calls.length === 0) {
        await ctx.reply(`📊 **No Calls Found**\n\nNo calls found for token: \`${mint}\`\n\nThis token hasn't been called by any of our tracked callers.`);
        return;
      }
      
      let message = `📊 **Found ${calls.length} calls for this token:**\n\n`;
      
      calls.forEach((call: any, index: number) => {
        const date = new Date(call.alert_timestamp).toISOString().split('T')[0];
        const time = new Date(call.alert_timestamp).toTimeString().substring(0, 5);
        const chainEmoji = call.chain === 'solana' ? '🟣' : call.chain === 'ethereum' ? '🔵' : call.chain === 'bsc' ? '🟡' : '⚪';
        
        message += `${index + 1}. ${chainEmoji} **${call.caller_name}** - ${date} ${time}\n`;
        message += `   Token: ${call.token_symbol || 'N/A'} | Chain: ${call.chain}\n`;
        message += `   Mint: \`${call.token_address}\`\n\n`;
      });
      
      message += `💡 **Use \`/backtest\` and paste the mint to run simulation with original call time!**`;
      
      await ctx.reply(message, { parse_mode: 'Markdown' });
      
    } catch (error) {
      console.error('Calls command error:', error);
      await this.sendError(ctx, 'Error retrieving calls. Please try again later.');
    }
  }
}
