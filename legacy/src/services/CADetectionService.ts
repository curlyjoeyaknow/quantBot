/**
 * CA Detection Service
 * ====================
 * Handles contract address (CA) drop detection and processing including
 * address validation, chain identification, token metadata fetching,
 * and monitoring setup.
 */

import { Context } from 'telegraf';
import axios from 'axios';
import { saveCADrop } from '../utils/database';
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
      } catch (error: unknown) {
        logger.error('Error processing CA drop', error instanceof Error ? error : new Error(String(error)), { address });
      }
    }
    return true;
  }

  /**
   * Handles CA registration + monitoring.
   * Identifies chain, fetches meta, logs and monitors (if enabled).
   */
  async processCADrop(ctx: Context, address: string): Promise<void> {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    
    if (!userId || !chatId) {
      logger.warn('Invalid context for CA processing', { userId, chatId });
      return;
    }

    // Validate address is plausible (format)
    const solanaPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    const evmPattern = /^0x[a-fA-F0-9]{40}$/;
    if (!solanaPattern.test(address) && !evmPattern.test(address)) {
      logger.warn('Invalid address format', { address });
      return;
    }

    // Decide which chain to try first (BSC/EVM fallback, else Solana)
    let chain = 'solana';
    if (address.startsWith('0x')) {
      chain = 'bsc'; // EVM heuristic: most new tokens first appear on BSC
    }

    try {
      // Try fetching meta-data (EVM: try BSC, ETH, BASE)
      let tokenData: any = null;
      let finalChain = chain;
      if (address.startsWith('0x')) {
        const chainsToTry = ['bsc', 'ethereum', 'base'];
        for (const tryChain of chainsToTry) {
          try {
            logger.debug('Trying chain for address', { chain: tryChain, address });
            const meta = await axios.get(`https://public-api.birdeye.so/defi/v3/token/meta-data/single`, {
              headers: {
                'X-API-KEY': process.env.BIRDEYE_API_KEY!,
                'accept': 'application/json',
                'x-chain': tryChain
              },
              params: { address }
            });
            if (meta.data.success && meta.data.data) {
              tokenData = meta.data.data;
              finalChain = tryChain;
              logger.debug('Found token on chain', { chain: tryChain, tokenName: tokenData?.name, address });
              break;
            }
          } catch (err) {
            logger.debug('Failed to find token on chain', { chain: tryChain, address });
            continue;
          }
        }
      } else {
        // Try Solana
        const meta = await axios.get(`https://public-api.birdeye.so/defi/v3/token/meta-data/single`, {
          headers: {
            'X-API-KEY': process.env.BIRDEYE_API_KEY!,
            'accept': 'application/json',
            'x-chain': chain
          },
          params: { address }
        });
        tokenData = meta.data.data;
        finalChain = chain;
      }
      if (!tokenData) {
        logger.warn('Token metadata not found on any supported chain', { address });
        return;
      }

      // Fix for lint error: add type for tokenData so TypeScript knows its shape
      interface TokenData {
        price?: number;
        mc?: number;
        name?: string;
        symbol?: string;
        [key: string]: any;
      }
      const typedTokenData = tokenData as TokenData;

      // Fetch current price and market cap using token overview endpoint
      let currentPrice = 0;
      let marketcap = 0;
      
      try {
        const overviewResponse = await axios.get(`https://public-api.birdeye.so/defi/token_overview`, {
          headers: {
            'X-API-KEY': process.env.BIRDEYE_API_KEY!,
            'accept': 'application/json',
            'x-chain': finalChain
          },
          params: { address }
        });
        
        if (overviewResponse.data.success && overviewResponse.data.data) {
          currentPrice = overviewResponse.data.data.price || 0;
          marketcap = overviewResponse.data.data.marketCap || 0;
        }
      } catch (error: unknown) {
        logger.warn('Failed to fetch token overview', { address, error: error instanceof Error ? error.message : String(error) });
        // Fallback to token metadata if available
        currentPrice = typedTokenData.price || 0;
        marketcap = typedTokenData.mc || 0;
      }

      // Always use default strategy/SL for auto CA monitoring
      const strategy = this.DEFAULT_STRATEGY;
      const stopLossConfig = { initial: -0.5, trailing: 0.5 };

      // Save CA drop in database for tracking/history
      const caId = await saveCADrop({
        userId,
        chatId,
        mint: address,
        chain: finalChain,
        tokenName: (tokenData as any).name,
        tokenSymbol: (tokenData as any).symbol,
        callPrice: currentPrice,
        callMarketcap: marketcap,
        callTimestamp: Math.floor(Date.now() / 1000),
        strategy,
        stopLossConfig
      });

      // If Solana and Helius monitor present, register for realtime updates
      try {
        const heliusMonitor = require('../helius-monitor').HeliusMonitor;
        if (heliusMonitor && finalChain === 'solana') {
          await heliusMonitor.addCATracking({
            id: caId,
            mint: address,
            chain: finalChain,
            tokenName: (tokenData as any).name,
            tokenSymbol: (tokenData as any).symbol,
            callPrice: currentPrice,
            callMarketcap: marketcap,
            callTimestamp: Math.floor(Date.now() / 1000),
            strategy,
            stopLossConfig,
            chatId,
            userId
          });
        }
      } catch (error: unknown) {
        logger.warn('Helius monitor not available', { error: error instanceof Error ? error.message : String(error) });
      }

      // Compose confirmation message to user/chat
      const chainEmoji = finalChain === 'ethereum' ? '⟠' : 
                        finalChain === 'bsc' ? '🟡' : 
                        finalChain === 'base' ? '🔵' : '◎';
      const monitoringStatus = finalChain === 'solana' ? 
        '✅ Real-time monitoring active!' : 
        '⚠️ Real-time monitoring not available for this chain';

      const message = `🎯 **CA Drop Detected & Tracking Started!**\n\n` +
        `${chainEmoji} Chain: ${finalChain.toUpperCase()}\n` +
        `🪙 Token: ${tokenData?.name || 'Unknown'} (${tokenData?.symbol || 'N/A'})\n` +
        `💰 Price: ${currentPrice > 0 ? `$${currentPrice.toFixed(8)}` : 'Loading...'}\n` +
        `📊 Market Cap: ${marketcap > 0 ? `$${(marketcap / 1000000).toFixed(2)}M` : 'Loading...'}\n` +
        `📈 Strategy: 50%@2x, 30%@5x, 20%@10x\n` +
        `🛑 Stop Loss: -50% initial, 50% trailing\n\n` +
        `${monitoringStatus}`;

      await ctx.reply(message, { parse_mode: 'Markdown' });

      logger.info('Started tracking CA', { tokenName: tokenData.name, address, chain: finalChain });
    } catch (error: unknown) {
      logger.error('Error fetching token metadata for CA', error instanceof Error ? error : new Error(String(error)), { address });
      // On errors during CA detection, fail silently to avoid chat spam
    }
  }
}
