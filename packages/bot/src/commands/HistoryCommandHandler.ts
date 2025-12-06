/**
 * History Command Handler
 * =======================
 * Handles the /history command for showing historical CA calls/alerts
 * stored in the database.
 */

import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { getAllCACalls } from '@quantbot/utils';
import { logger } from '@quantbot/utils';

export class HistoryCommandHandler extends BaseCommandHandler {
  readonly command = 'history';
  
  async execute(ctx: Context, session?: Session): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await this.sendError(ctx, 'Unable to identify user.');
      return;
    }
    
    logger.debug('/history command triggered', { userId });
    
    try {
      // Get all CA drops from database (limit to 10 for pagination)
      const caDrops = await getAllCACalls(10);

      if (caDrops.length === 0) {
        await ctx.reply('📊 **No Historical CA Calls Found**\n\nCA calls will be automatically stored when detected in the channel.');
        return;
      }

      let historyMessage = `📊 **Recent CA Calls (${caDrops.length} shown)**\n\n`;

      // Show calls in chronological order (newest first)
      for (const call of caDrops as any[]) {
        const ts = call.call_timestamp ?? call.alert_timestamp;
        const date = ts ? new Date(ts * 1000).toISOString().split('T')[0] : 'Unknown';
        const time = ts ? new Date(ts * 1000).toTimeString().substring(0, 5) : 'Unknown';
        const chainEmoji = call.chain === 'solana' ? '🟣' : call.chain === 'ethereum' ? '🔵' : call.chain === 'bsc' ? '🟡' : '⚪';
        
        historyMessage += `${chainEmoji} ${date} ${time} | ${call.token_name || 'Unknown'} (${call.token_symbol || 'N/A'})\n`;
        historyMessage += `   Caller: ${call.caller || call.caller_name || 'Unknown'} | Price: $${call.call_price?.toFixed?.(8) || 'N/A'}\n`;
        historyMessage += `   Mint: \`${call.mint.replace(/`/g, '\\`')}\`\n\n`;
      }

      // Add summary and pagination info
      const chains = [...new Set(caDrops.map((c: any) => c.chain))];
      const callers = [...new Set((caDrops as any[]).map((c) => c.caller || c.caller_name).filter(Boolean))];
      
      historyMessage += `📈 **Summary:**\n`;
      historyMessage += `• Chains: ${chains.join(', ')}\n`;
      historyMessage += `• Callers: ${callers.length}\n`;
      historyMessage += `• Showing: ${caDrops.length} recent calls\n\n`;
      historyMessage += `💡 Use \`/backtest_call <mint>\` to run strategy on any call`;

      await ctx.reply(historyMessage, { parse_mode: 'Markdown' });

    } catch (error) {
      logger.error('History command error', error as Error, { userId });
      await ctx.reply('❌ Error retrieving historical data. Please try again later.');
    }
  }
}
