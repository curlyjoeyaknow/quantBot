/**
 * Alert Command Handler
 * =====================
 * Handles the /alert command for manual token monitoring
 */

import { Context } from 'telegraf';
import axios from 'axios';
import { BaseCommandHandler } from './interfaces/CommandHandler';
import { Session } from './interfaces/CommandHandler';
import { CAService } from '../services/CAService';

export class AlertCommandHandler extends BaseCommandHandler {
  readonly command = 'alert';

  constructor(private caService: CAService) {
    super();
  }

  async execute(ctx: Context, session?: Session): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply('❌ Unable to identify user');
      return;
    }

    const message = (ctx.message as any)?.text || '';
    
    // Extract mint address from command
    const parts = message.split(' ');
    if (parts.length < 2) {
      await ctx.reply('❌ **Usage:** `/alert <mint_address>`\n\nExample: `/alert So11111111111111111111111111111111111111112`');
      return;
    }
    
    const mint = parts[1];
    
    try {
      // Determine chain based on address format
      let chain = 'solana';
      if (mint.startsWith('0x')) {
        chain = 'ethereum'; // Default to ethereum for 0x addresses
      }
      
      // Fetch token metadata
      const meta = await axios.get(`https://public-api.birdeye.so/defi/v3/token/meta-data/single`, {
        headers: {
          'X-API-KEY': process.env.BIRDEYE_API_KEY!,
          'accept': 'application/json',
          'x-chain': chain
        },
        params: {
          address: mint
        }
      });
      
      if (!meta.data.success) {
        await ctx.reply(`❌ **Invalid Token Address**\n\nThe address \`${mint}\` is not recognized as a valid token on ${chain.toUpperCase()}.`);
        return;
      }
      
      const tokenData = meta.data.data;
      const tokenName = tokenData.name || 'Unknown';
      const tokenSymbol = tokenData.symbol || 'N/A';
      const currentPrice = tokenData.price || 0;
      
      // Process as CA drop for monitoring
      await this.caService.processCADrop({
        userId,
        chatId: ctx.chat?.id || userId,
        mint,
        chain,
        tokenName,
        tokenSymbol,
        callPrice: currentPrice,
        callMarketcap: tokenData.mc || 0,
        callTimestamp: Math.floor(Date.now() / 1000)
      });
      
      await ctx.reply(`🔔 **Alert Set Successfully!**\n\n` +
        `🪙 **${tokenName}** (${tokenSymbol})\n` +
        `🔗 **Chain**: ${chain.toUpperCase()}\n` +
        `💰 **Current Price**: $${currentPrice.toFixed(8)}\n\n` +
        `Monitoring started! You'll receive alerts for:\n` +
        `• Price target hits\n` +
        `• Stop loss triggers\n` +
        `• Significant price movements\n\n` +
        `Use \`/alerts\` to see all active monitors.`);
      
    } catch (error) {
      console.error('Alert command error:', error);
      await ctx.reply('❌ **Alert Setup Failed**\n\nAn error occurred while setting up the alert. Please check the token address and try again.');
    }
  }
}