/**
 * Calls Command Handler
 * =====================
 * Handles the /calls command for showing all historical calls for a specific token.
 * Displays caller name, timestamp, price, chain info.
 */

import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { findCallsForToken } from '@quantbot/utils';
import { logger } from '@quantbot/utils';
import { extractCommandArgs, isValidTokenAddress, sanitizeInput } from '../utils/command-helpers';

export class CallsCommandHandler extends BaseCommandHandler {
  readonly command = 'calls';
  
  protected defaultOptions = {
    timeout: 30_000, // 30 seconds
    requirePrivateChat: true,
    rateLimit: true,
    showTyping: true,
  };
  
  async execute(ctx: Context, session?: Session): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await this.sendError(ctx, 'Unable to identify user.');
      return;
    }
    
    // Parse command arguments
    const message = 'text' in (ctx.message ?? {}) ? (ctx.message as { text: string }).text : '';
    const args = extractCommandArgs(message, this.command);
    
    if (args.length < 1) {
      await ctx.reply(
        '❌ **Usage:** `/calls <mint_address>`\n\n' +
        'Example: `/calls So11111111111111111111111111111111111111112`',
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    // Sanitize and validate token address
    const mint = sanitizeInput(args[0], 100);
    
    if (!isValidTokenAddress(mint)) {
      await this.sendError(
        ctx,
        'Invalid token address format. Please provide a valid Solana or EVM address.'
      );
      return;
    }
    
    try {
      const progress = this.createProgressMessage(ctx);
      await progress.send('🔍 **Searching for calls...**');
      
      const calls = await findCallsForToken(mint);
      
      await progress.delete();
      
      if (calls.length === 0) {
        await ctx.reply(
          `📊 **No Calls Found**\n\n` +
          `No calls found for token: \`${mint}\`\n\n` +
          `This token hasn't been called by any of our tracked callers.`,
          { parse_mode: 'Markdown' }
        );
        return;
      }
      
      let resultMessage = `📊 **Found ${calls.length} calls for this token:**\n\n`;
      
      calls.forEach((call: any, index: number) => {
        const date = new Date(call.alert_timestamp).toISOString().split('T')[0];
        const time = new Date(call.alert_timestamp).toTimeString().substring(0, 5);
        const chainEmoji = call.chain === 'solana' ? '🟣' : 
                          call.chain === 'ethereum' ? '🔵' : 
                          call.chain === 'bsc' ? '🟡' : '⚪';
        
        resultMessage += `${index + 1}. ${chainEmoji} **${call.caller_name}** - ${date} ${time}\n`;
        resultMessage += `   Token: ${call.token_symbol || 'N/A'} | Chain: ${call.chain}\n`;
        resultMessage += `   Mint: \`${call.token_address}\`\n\n`;
      });
      
      resultMessage += `💡 **Use \`/backtest\` and paste the mint to run simulation with original call time!**`;
      
      await ctx.reply(resultMessage, { parse_mode: 'Markdown' });
      
    } catch (error) {
      logger.error('Calls command error', error as Error, { userId, mint });
      await this.sendError(ctx, '❌ Error retrieving calls. Please try again later.');
    }
  }
}
