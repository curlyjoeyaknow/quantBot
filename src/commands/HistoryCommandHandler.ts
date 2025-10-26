/**
 * History Command Handler
 * =======================
 * Handles the /history command for showing historical CA calls/alerts
 * stored in the database.
 */

import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { getAllCACalls } from '../utils/database';

export class HistoryCommandHandler extends BaseCommandHandler {
  readonly command = 'history';
  
  async execute(ctx: Context, session?: Session): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await this.sendError(ctx, 'Unable to identify user.');
      return;
    }
    
    console.log(`[DEBUG] /history command triggered by user ${userId}`);
    
    try {
      // Get all CA drops from database
      const caDrops = await getAllCACalls(50);
      
      if (caDrops.length === 0) {
        await ctx.reply('📊 **No CA History Found**\n\nNo CA drops have been tracked yet. Use `/extract` to extract CA drops from messages.');
        return;
      }
      
      // Format the history message
      let message = `📊 **CA Drop History** (${caDrops.length} total)\n\n`;
      
      // Show last 10 entries
      const recentDrops = caDrops.slice(-10).reverse();
      
      recentDrops.forEach((drop, index) => {
        const chainEmoji = drop.chain === 'ethereum' ? '⟠' : 
                          drop.chain === 'bsc' ? '🟡' : 
                          drop.chain === 'base' ? '🔵' : '◎';
        
        const timestamp = new Date(drop.callTimestamp * 1000).toLocaleString();
        const price = drop.callPrice ? `$${drop.callPrice.toFixed(6)}` : 'N/A';
        const marketcap = drop.callMarketcap ? `$${(drop.callMarketcap / 1000000).toFixed(2)}M` : 'N/A';
        
        message += `${index + 1}. ${chainEmoji} **${drop.tokenName || 'Unknown'}** (${drop.tokenSymbol || 'N/A'})\n`;
        message += `   📍 ${drop.mint}\n`;
        message += `   💰 Price: ${price} | Market Cap: ${marketcap}\n`;
        message += `   📅 ${timestamp}\n\n`;
      });
      
      if (caDrops.length > 10) {
        message += `... and ${caDrops.length - 10} more entries\n\n`;
      }
      
      message += 'Use `/backtest_call` to backtest any of these CA drops with strategies.';
      
      await ctx.reply(message, { parse_mode: 'Markdown' });
      
    } catch (error) {
      console.error('History command error:', error);
      await this.sendError(ctx, 
        '❌ **History Retrieval Failed**\n\n' +
        'An error occurred while fetching CA history. Please try again later.'
      );
    }
  }
}
