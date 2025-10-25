/**
 * Alerts Command Handler
 * =====================
 * Handles the /alerts command to show active monitoring
 */

import { Context } from 'telegraf';
import { BaseCommandHandler } from './interfaces/CommandHandler';
import { Session } from './interfaces/CommandHandler';
import { CAService } from '../services/CAService';

export class AlertsCommandHandler extends BaseCommandHandler {
  readonly command = 'alerts';

  constructor(private caService: CAService) {
    super();
  }

  async execute(ctx: Context, session?: Session): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply('❌ Unable to identify user');
      return;
    }

    try {
      // Get active CA tracking for user
      const activeCAs = await this.caService.getActiveCATracking(userId);
      
      if (activeCAs.length === 0) {
        await ctx.reply('📊 **No Active Alerts**\n\nYou don\'t have any active token monitoring alerts.\n\nUse `/alert <mint_address>` to start monitoring a token.');
        return;
      }
      
      let message = '🔔 **Active Alerts**\n\n';
      
      for (const ca of activeCAs) {
        const entryPrice = ca.entryPrice || 0;
        const currentPrice = ca.currentPrice || entryPrice;
        const pnl = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;
        
        message += `🪙 **${ca.tokenName || 'Unknown'}** (${ca.tokenSymbol || 'N/A'})\n`;
        message += `🔗 **Chain**: ${ca.chain?.toUpperCase() || 'SOLANA'}\n`;
        message += `💰 **Entry**: $${entryPrice.toFixed(8)}\n`;
        message += `📈 **Current**: $${currentPrice.toFixed(8)}\n`;
        message += `📊 **PnL**: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%\n`;
        message += `🎯 **Targets**: ${ca.strategy?.map(s => `${s.percent * 100}% @ ${s.target}x`).join(', ') || 'None'}\n`;
        message += `🛑 **Stop Loss**: ${ca.stopLoss ? `${ca.stopLoss * 100}%` : 'None'}\n`;
        message += `⏰ **Started**: ${new Date(ca.createdAt).toLocaleString()}\n\n`;
      }
      
      message += `Use \`/alert <mint_address>\` to add more alerts.\n`;
      message += `Use \`/cancel\` to stop all monitoring.`;
      
      await ctx.reply(message);
      
    } catch (error) {
      console.error('Alerts command error:', error);
      await ctx.reply('❌ **Failed to Load Alerts**\n\nAn error occurred while loading your active alerts.');
    }
  }
}