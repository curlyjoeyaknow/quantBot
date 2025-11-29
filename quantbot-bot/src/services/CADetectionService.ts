/**
 * CA Detection Service
 * ====================
 * Handles contract address (CA) drop detection and processing including
 * address validation, chain identification, token metadata fetching,
 * and monitoring setup.
 */

import { Context } from 'telegraf';
import axios from 'axios';
import { saveCADrop } from '../database/client';
import { logger } from '../utils/logger';

export class CADetectionService {
  private readonly DEFAULT_STRATEGY = [
    { percent: 0.5, target: 2 },
    { percent: 0.3, target: 5 },
    { percent: 0.2, target: 10 }
  ];

  /**
   * Detects contract address (CA) drops in free-form user text.
   * Returns true if any CA was detected/processed, otherwise false.
   */
  async detectCADrop(ctx: Context, text: string): Promise<boolean> {
    // Regex patterns for Solana and EVM addresses
    const solanaAddressPattern = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
    const evmAddressPattern = /0x[a-fA-F0-9]{40}/g;
    const solanaMatches = text.match(solanaAddressPattern);
    const evmMatches = text.match(evmAddressPattern);
    const addresses = [...(solanaMatches || []), ...(evmMatches || [])];

    if (addresses.length === 0) return false;

    // Detect if the message context really looks like a CA drop (keywords/trading context, etc).
    const caKeywords = ['ca', 'contract', 'address', 'buy', 'pump', 'moon', 'gem', 'call'];
    const hasCAKeywords = caKeywords.some(keyword =>
      text.toLowerCase().includes(keyword)
    );
    if (!hasCAKeywords && addresses.length === 1) {
      // Ignore single addresses when not in a drop context.
      return false;
    }

    logger.debug('Potential CA drop detected', { addresses, hasKeywords: hasCAKeywords });

    // Process all CA(s) found in message
    for (const address of addresses) {
      try {
        await this.processCADrop(ctx, address);
      } catch (error) {
        logger.error('Error processing CA drop', error as Error, { address });
      }
    }

    return true;
  }

  /**
   * Process a single CA drop
   */
  private async processCADrop(ctx: Context, address: string): Promise<void> {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;

    if (!userId || !chatId) {
      logger.warn('Missing userId or chatId in CA drop processing');
      return;
    }

    // Determine chain
    let chain = 'solana';
    if (address.startsWith('0x') && address.length === 42) {
      // EVM address - would need user input for chain, default to ethereum
      chain = 'ethereum';
    }

    try {
      // Fetch token metadata (simplified - would call core service API)
      const metadata = await this.fetchTokenMetadata(address, chain);

      // Save CA drop to database
      const caId = await saveCADrop({
        mint: address,
        chain,
        tokenName: metadata.name,
        tokenSymbol: metadata.symbol,
        callPrice: metadata.price,
        callMarketcap: metadata.marketCap,
        callTimestamp: Math.floor(Date.now() / 1000),
        caller: ctx.from?.username || ctx.from?.first_name || 'unknown',
        sourceChatId: chatId,
      });

      if (caId) {
        await ctx.reply(
          `✅ **CA Drop Detected & Saved**\n\n` +
          `📍 **Token:** ${metadata.symbol || 'Unknown'} (${address.substring(0, 8)}...)\n` +
          `🔗 **Chain:** ${chain}\n` +
          `💰 **Price:** $${metadata.price?.toFixed(6) || 'N/A'}\n` +
          `📊 **Market Cap:** $${metadata.marketCap ? (metadata.marketCap / 1e6).toFixed(2) + 'M' : 'N/A'}\n\n` +
          `Tracking started. Use /alerts to view all tracked tokens.`
        );
      }
    } catch (error) {
      logger.error('Error processing CA drop', error as Error, { address, chain });
      await ctx.reply(`❌ Error processing CA drop: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Fetch token metadata
   * TODO: Replace with call to core service API
   */
  private async fetchTokenMetadata(address: string, chain: string): Promise<{
    name?: string;
    symbol?: string;
    price?: number;
    marketCap?: number;
  }> {
    // Simplified - would call core service API
    // For now, return minimal data
    return {
      symbol: address.substring(0, 8),
    };
  }
}
