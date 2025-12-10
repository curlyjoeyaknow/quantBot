/**
 * Watchlist Command Handler
 * =========================
 * View and manage the watchlist of monitored tokens
 */

import { Context, Markup } from 'telegraf';
import { BaseCommandHandler } from './interfaces/CommandHandler';
import { getActiveMonitoredTokens, updateMonitoredTokenStatus, MonitoredToken } from '../utils/monitored-tokens-db';
import { logger } from '../utils/logger';

export class WatchlistCommandHandler extends BaseCommandHandler {
  readonly command = 'watchlist';

  async execute(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await this.sendError(ctx, 'Unable to identify user.');
      return;
    }

    try {
      await ctx.reply('📊 **Loading watchlist...**', { parse_mode: 'Markdown' });

      const tokens = await getActiveMonitoredTokens();

      if (tokens.length === 0) {
        await ctx.reply(
          '📋 **Watchlist is Empty**\n\n' +
          'No tokens are currently being monitored.\n\n' +
          'Tokens are automatically added when:\n' +
          '• CurlyJoe makes a call in the channel\n' +
          '• You use `/addcurlyjoe` to add calls manually',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      // Group by caller
      const byCaller = new Map<string, MonitoredToken[]>();
      for (const token of tokens) {
        const caller = token.callerName || 'unknown';
        if (!byCaller.has(caller)) {
          byCaller.set(caller, []);
        }
        byCaller.get(caller)!.push(token);
      }

      // Separate Solana and ETH/BSC tokens
      const solanaTokens = tokens.filter(t => t.chain === 'solana');
      const ethBscTokens = tokens.filter(t => t.chain !== 'solana');
      
      let message = `📋 **Watchlist (${tokens.length} tokens)**\n\n`;
      message += `**Solana:** ${solanaTokens.length}/50 (WebSocket limit)\n`;
      message += `**ETH/BSC:** ${ethBscTokens.length} (RPC polling, no limit)\n\n`;

      // Show tokens grouped by caller
      for (const [caller, callerTokens] of byCaller.entries()) {
        message += `**${caller.toUpperCase()}** (${callerTokens.length}):\n\n`;
        
        // Show first 10 tokens per caller (to avoid message length limits)
        const tokensToShow = callerTokens.slice(0, 10);
        
        for (let i = 0; i < tokensToShow.length; i++) {
          const token = tokensToShow[i];
          const symbol = token.tokenSymbol || token.tokenAddress.slice(0, 8);
          const alertDate = new Date(token.alertTimestamp).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });
          
          const priceChange = token.lastPrice && token.alertPrice
            ? ((token.lastPrice - token.alertPrice) / token.alertPrice * 100).toFixed(2)
            : 'N/A';
          
          const statusEmoji = token.entrySignalSent ? '✅' : '⏳';
          const priceEmoji = token.lastPrice && token.alertPrice
            ? (token.lastPrice >= token.alertPrice ? '📈' : '📉')
            : '📊';
          
          message += `${i + 1}. ${statusEmoji} **${symbol}** (${token.chain})\n`;
          message += `   ${priceEmoji} Alert: $${token.alertPrice.toFixed(8)} | `;
          if (token.lastPrice) {
            message += `Current: $${token.lastPrice.toFixed(8)} (${priceChange >= 0 ? '+' : ''}${priceChange}%)\n`;
          } else {
            message += `Current: N/A\n`;
          }
          message += `   📅 ${alertDate} | 🕯️ ${token.historicalCandlesCount || 0} candles\n`;
          
          if (token.entryPrice) {
            message += `   ✅ Entry: $${token.entryPrice.toFixed(8)} (${token.entryType || 'unknown'})\n`;
          }
          message += `\n`;
        }
        
        if (callerTokens.length > 10) {
          message += `_... and ${callerTokens.length - 10} more tokens_\n\n`;
        }
      }

      // Add action buttons
      const buttons = [
        [Markup.button.callback('🔄 Refresh', 'watchlist:refresh')],
        [Markup.button.callback('📊 View All', 'watchlist:viewall')],
        [Markup.button.callback('🗑️ Clear Oldest', 'watchlist:clearoldest')],
      ];

      await ctx.reply(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });

    } catch (error) {
      logger.error('Watchlist command error', error as Error, { userId });
      await this.sendError(ctx, '❌ Error loading watchlist. Please try again later.');
    }
  }

  /**
   * Handle callback queries for watchlist actions
   */
  static async handleCallback(ctx: Context, data: string): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.answerCbQuery('Unable to identify user.');
      return;
    }

    try {
      const [action] = data.split(':');

      if (action === 'refresh') {
        await ctx.answerCbQuery('Refreshing...');
        // Re-execute the command
        const handler = new WatchlistCommandHandler();
        await handler.execute(ctx);
        return;
      }

      if (action === 'viewall') {
        await ctx.answerCbQuery('Loading all tokens...');
        const tokens = await getActiveMonitoredTokens();
        
        if (tokens.length === 0) {
          await ctx.editMessageText('📋 **Watchlist is Empty**', { parse_mode: 'Markdown' });
          return;
        }

        // Create a detailed list
        let message = `📋 **All Watchlist Tokens (${tokens.length})**\n\n`;
        
        tokens.forEach((token, index) => {
          const symbol = token.tokenSymbol || token.tokenAddress.slice(0, 8);
          const alertDate = new Date(token.alertTimestamp).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });
          
          message += `${index + 1}. **${symbol}** (${token.chain})\n`;
          message += `   Address: \`${token.tokenAddress.slice(0, 16)}...\`\n`;
          message += `   Alert: $${token.alertPrice.toFixed(8)} | `;
          if (token.lastPrice) {
            message += `Current: $${token.lastPrice.toFixed(8)}\n`;
          } else {
            message += `Current: N/A\n`;
          }
          message += `   ${alertDate} | ${token.callerName}\n`;
          if (token.entrySignalSent) {
            message += `   ✅ Entry signal sent\n`;
          }
          message += `\n`;
        });

        await ctx.editMessageText(message, { parse_mode: 'Markdown' });
        return;
      }

      if (action === 'clearoldest') {
        await ctx.answerCbQuery('Removing oldest Solana tokens...');
        const tokens = await getActiveMonitoredTokens();
        
        // Only remove Solana tokens (they have the limit)
        const solanaTokens = tokens.filter(t => t.chain === 'solana');
        
        if (solanaTokens.length === 0) {
          await ctx.editMessageText(
            '📋 **No Solana Tokens to Remove**\n\n' +
            'Only Solana tokens are limited (50 max). ETH/BSC tokens have no limit.',
            { parse_mode: 'Markdown' }
          );
          return;
        }

        // Remove oldest 10 oldest Solana tokens
        const sorted = solanaTokens.sort((a, b) => 
          a.alertTimestamp.getTime() - b.alertTimestamp.getTime()
        );
        const toRemove = sorted.slice(0, Math.min(10, solanaTokens.length));

        let removedCount = 0;
        for (const token of toRemove) {
          if (token.id) {
            try {
              await updateMonitoredTokenStatus(token.id, 'removed');
              removedCount++;
            } catch (error) {
              logger.warn('Failed to remove token from watchlist', { tokenId: token.id });
            }
          }
        }

        await ctx.editMessageText(
          `✅ **Removed ${removedCount} Oldest Solana Tokens**\n\n` +
          `Removed the oldest ${removedCount} Solana tokens from the watchlist.\n\n` +
          `**Note:** Only Solana tokens are limited (50 max). ETH/BSC tokens have no limit.\n\n` +
          `Use \`/watchlist\` to view the updated list.`,
          { parse_mode: 'Markdown' }
        );
        return;
      }

      await ctx.answerCbQuery('Unknown action');
    } catch (error) {
      logger.error('Watchlist callback error', error as Error, { userId });
      await ctx.answerCbQuery('❌ Error processing request.');
    }
  }
}

