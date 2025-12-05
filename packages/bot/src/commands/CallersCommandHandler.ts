/**
 * Callers Command Handler
 * =======================
 * Handles the /callers command for showing top callers statistics
 * and database statistics.
 */

import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { getCallerStats } from '@quantbot/utils';
import { logger } from '@quantbot/utils';

export class CallersCommandHandler extends BaseCommandHandler {
  readonly command = 'callers';
  
  async execute(ctx: Context, session?: Session): Promise<void> {
    try {
      await ctx.reply('📊 **Loading caller statistics...**');
      
      const { stats, topCallers } = await getCallerStats();
      
      if (!stats) {
        await ctx.reply('❌ Error loading caller statistics.');
        return;
      }
      
      let message = `📊 **Caller Database Statistics**\n\n`;
      message += `🗄️ **Database Stats:**\n`;
      message += `• Total alerts: ${stats.total_alerts}\n`;
      message += `• Total callers: ${stats.total_callers}\n`;
      message += `• Total tokens: ${stats.total_tokens}\n`;
      message += `• Date range: ${stats.earliest_alert?.split('T')[0]} to ${stats.latest_alert?.split('T')[0]}\n\n`;
      
      message += `🏆 **Top 10 Callers:**\n`;
      topCallers.forEach((caller: any, index: number) => {
        message += `${index + 1}. **${caller.caller_name}** - ${caller.alert_count} alerts, ${caller.token_count} tokens\n`;
      });
      
      message += `\n💡 **Use \`/calls <mint>\` to see calls for a specific token!**`;
      
      await ctx.reply(message, { parse_mode: 'Markdown' });
      
    } catch (error) {
      logger.error('Callers command error', error as Error, { userId: ctx.from?.id });
      await this.sendError(ctx, '❌ Error loading caller statistics. Please try again later.');
    }
  }
}
