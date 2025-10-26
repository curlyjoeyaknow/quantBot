/**
 * Recent Command Handler
 * ======================
 * Handles the /recent command for showing recent calls.
 */

import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { getRecentCalls } from '../utils/caller-database';

export class RecentCommandHandler extends BaseCommandHandler {
  readonly command = 'recent';
  
  async execute(ctx: Context, session?: Session): Promise<void> {
    try {
      await ctx.reply('📊 **Loading recent calls...**');
      
      const calls = await getRecentCalls(15);
      
      if (calls.length === 0) {
        await ctx.reply('📊 **No Recent Calls Found**\n\nNo calls found in the database.');
        return;
      }
      
      let message = `📊 **Recent Calls (${calls.length} shown)**\n\n`;
      
      calls.forEach((call: any, index: number) => {
        const date = new Date(call.alert_timestamp).toISOString().split('T')[0];
        const time = new Date(call.alert_timestamp).toTimeString().substring(0, 5);
        const chainEmoji = call.chain === 'solana' ? '🟣' : call.chain === 'ethereum' ? '🔵' : call.chain === 'bsc' ? '🟡' : '⚪';
        
        message += `${index + 1}. ${chainEmoji} **${call.caller_name}** - ${date} ${time}\n`;
        message += `   Token: ${call.token_symbol || 'N/A'} | Chain: ${call.chain}\n`;
        message += `   Mint: \`${call.token_address}\`\n\n`;
      });
      
      message += `💡 **Use \`/backtest\` and paste any mint to run simulation!**`;
      
      await ctx.reply(message, { parse_mode: 'Markdown' });
      
    } catch (error) {
      console.error('Recent command error:', error);
      await this.sendError(ctx, 'Error retrieving recent calls. Please try again later.');
    }
  }
}
