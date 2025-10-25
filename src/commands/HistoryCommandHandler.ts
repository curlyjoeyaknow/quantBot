/**
 * History Command Handler
 * =======================
 * Handles the /history command for displaying simulation history
 */

import { Context } from 'telegraf';
import { BaseCommandHandler } from './interfaces/CommandHandler';
import { Session } from './interfaces/CommandHandler';
import { SimulationService } from '../services/SimulationService';

export class HistoryCommandHandler extends BaseCommandHandler {
  readonly command = 'history';

  constructor(private simulationService: SimulationService) {
    super();
  }

  async execute(ctx: Context, session?: Session): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply('❌ Unable to identify user');
      return;
    }

    console.log(`[DEBUG] /history command triggered by user ${userId}`);
    
    // Clear any existing session to prevent conflicts
    if (session) {
      Object.keys(session).forEach(key => delete session[key]);
    }
    
    try {
      // Get CA calls from the database (limit to 10 for pagination)
      const db = require('../utils/database');
      const calls = await db.getAllCACalls(10); // Get only 10 recent calls

      if (calls.length === 0) {
        await ctx.reply('📊 **No Historical CA Calls Found**\n\nCA calls will be automatically stored when detected in the channel.');
        return;
      }

      let historyMessage = `📊 **Recent CA Calls (${calls.length} shown)**\n\n`;

      // Show calls in chronological order (newest first)
      for (const call of calls) {
        const date = call.call_timestamp ? new Date(call.call_timestamp * 1000).toISOString().split('T')[0] : 'Unknown';
        const time = call.call_timestamp ? new Date(call.call_timestamp * 1000).toTimeString().substring(0, 5) : 'Unknown';
        const chainEmoji = call.chain === 'solana' ? '🟣' : call.chain === 'ethereum' ? '🔵' : call.chain === 'bsc' ? '🟡' : '⚪';
        
        historyMessage += `${chainEmoji} ${date} ${time} | ${call.token_name || 'Unknown'} (${call.token_symbol || 'N/A'})\n`;
        historyMessage += `   Caller: ${call.caller || 'Unknown'} | Price: $${call.call_price?.toFixed(8) || 'N/A'}\n`;
        historyMessage += `   Mint: \`${call.mint.replace(/`/g, '\\`')}\`\n\n`;
      }

      // Add pagination info if there are more calls
      const totalCalls = await db.getTotalCACallsCount();
      if (totalCalls > 10) {
        historyMessage += `📄 Showing 10 of ${totalCalls} total calls\n`;
        historyMessage += `Use \`/backtest_call <mint>\` to backtest any of these calls`;
      }

      await ctx.reply(historyMessage);
      
    } catch (error) {
      console.error('History command error:', error);
      await ctx.reply('❌ **Failed to fetch history**\n\nAn error occurred while retrieving CA call history.');
    }
  }
}