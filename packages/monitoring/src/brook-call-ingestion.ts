/**
 * Brook Call Ingestion Module
 * ===========================
 * Ingests forwarded calls from Brook's channel, extracts token addresses,
 * stores them in the database, and adds them to live monitoring services.
 * 
 * This module listens for forwarded messages in your personal Telegram chat
 * and automatically processes them.
 */

import { Telegraf, Context } from 'telegraf';
import { DateTime } from 'luxon';
import axios from 'axios';
import { CallerDatabase, CallerAlert } from '@quantbot/utils' /* TODO: Fix storage import */;
import { logger } from '@quantbot/utils';
import { LiveTradeAlertService } from './live-trade-alert-service';
import { TenkanKijunAlertService } from './tenkan-kijun-alert-service';

const CALLER_NAME = 'Brook';
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || '';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '';
const PERSONAL_CHAT_ID = process.env.PERSONAL_CHAT_ID || '';

/**
 * Extract token addresses from text
 */
function extractTokenAddresses(text: string): string[] {
  const addresses: string[] = [];
  
  if (!text) return addresses;
  
  // Clean text
  let cleanText = text.replace(/<[^>]+>/g, ' ');
  cleanText = cleanText.replace(/&apos;/g, "'");
  cleanText = cleanText.replace(/&quot;/g, '"');
  cleanText = cleanText.replace(/&amp;/g, '&');
  
  // Solana: base58 addresses (32-44 chars)
  const solanaRegex = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
  const solanaMatches = cleanText.match(solanaRegex) || [];
  const validSolana = solanaMatches.filter(addr => {
    const len = addr.length;
    if (len < 32 || len > 44) return false;
    if (addr.toUpperCase().startsWith('DEF')) return false;
    return true;
  });
  addresses.push(...validSolana);
  
  // EVM: 0x + 40 hex chars
  const evmRegex = /0x[a-fA-F0-9]{40}\b/g;
  const evmMatches = cleanText.match(evmRegex) || [];
  addresses.push(...evmMatches);
  
  // Addresses in code blocks
  const codeBlockRegex = /`([1-9A-HJ-NP-Za-km-z]{32,44})`/g;
  const codeMatches = cleanText.match(codeBlockRegex) || [];
  codeMatches.forEach(match => {
    const addr = match.replace(/`/g, '').trim();
    if (addr.length >= 32 && addr.length <= 44 && !addr.toUpperCase().startsWith('DEF')) {
      if (!addresses.includes(addr)) {
        addresses.push(addr);
      }
    }
  });
  
  // Phanes bot format: "├ ADDRESS└"
  const phanesFormatRegex = /├\s*([1-9A-HJ-NP-Za-km-z]{32,44})\s*└/g;
  const phanesMatches = cleanText.matchAll(phanesFormatRegex);
  for (const match of phanesMatches) {
    const addr = match[1];
    if (addr && addr.length >= 32 && addr.length <= 44 && !addr.toUpperCase().startsWith('DEF')) {
      if (!addresses.includes(addr)) {
        addresses.push(addr);
      }
    }
  }
  
  // Remove duplicates
  const unique = new Set<string>();
  addresses.forEach(addr => {
    if (addr.startsWith('0x')) {
      unique.add(addr.toLowerCase());
    } else {
      unique.add(addr);
    }
  });
  
  return Array.from(unique);
}

/**
 * Determine chain from address format
 */
function determineChain(address: string): 'solana' | 'ethereum' | 'bsc' | 'base' {
  if (address.startsWith('0x')) {
    // Default to BSC for EVM addresses (most common for new tokens)
    return 'bsc';
  }
  return 'solana';
}

/**
 * Fetch token metadata from Birdeye
 */
async function fetchTokenMetadata(
  address: string,
  chain: string
): Promise<{ name: string; symbol: string; price: number } | null> {
  try {
    const response = await axios.get(
      'https://public-api.birdeye.so/defi/v3/token/meta-data/single',
      {
        params: { address },
        headers: {
          'X-API-KEY': BIRDEYE_API_KEY,
          'accept': 'application/json',
          'x-chain': chain,
        },
        timeout: 10000,
      }
    );

    if (response.data?.success && response.data?.data) {
      const data = response.data.data;
      const price = parseFloat(data.price || '0');
      
      return {
        name: data.name || 'Unknown',
        symbol: data.symbol || 'UNKNOWN',
        price,
      };
    }
  } catch (error) {
    logger.warn('Failed to fetch token metadata', {
      address,
      chain,
      error: (error as Error).message,
    });
  }

  return null;
}

/**
 * Brook Call Ingestion Service
 */
export class BrookCallIngestion {
  private bot: Telegraf;
  private callerDb: CallerDatabase;
  private liveTradeService: LiveTradeAlertService | null = null;
  private tenkanKijunService: TenkanKijunAlertService | null = null;
  private processedMessageIds: Set<number> = new Set();
  private brookChannelId: string;
  private personalChatId: string | null;

  constructor(
    botToken: string,
    brookChannelId: string,
    personalChatId?: string,
    liveTradeService?: LiveTradeAlertService,
    tenkanKijunService?: TenkanKijunAlertService
  ) {
    this.bot = new Telegraf(botToken);
    this.callerDb = new CallerDatabase();
    this.brookChannelId = brookChannelId;
    this.personalChatId = personalChatId || null;
    this.liveTradeService = liveTradeService || null;
    this.tenkanKijunService = tenkanKijunService || null;
    
    this.setupHandlers();
  }

  /**
   * Check if message is from Brook's channel
   */
  private isFromBrookChannel(ctx: Context): boolean {
    const chatId = ctx.chat?.id;
    if (!chatId) return false;
    
    // Handle both numeric IDs and usernames
    let channelId: string | number = this.brookChannelId;
    if (!this.brookChannelId.startsWith('@') && !isNaN(parseInt(this.brookChannelId))) {
      channelId = parseInt(this.brookChannelId);
    }
    
    const chatIdStr = String(chatId);
    const channelIdStr = String(channelId);
    
    return chatIdStr === channelIdStr || chatId === channelId;
  }

  /**
   * Check if message is from personal chat (for manual forwarding)
   */
  private isFromPersonalChat(ctx: Context): boolean {
    if (!this.personalChatId) return false;
    
    const chatId = ctx.chat?.id;
    if (!chatId) return false;
    
    const personalChatIdNum = parseInt(this.personalChatId);
    const chatIdStr = String(chatId);
    const personalChatIdStr = this.personalChatId;
    
    return chatId === personalChatIdNum || chatIdStr === personalChatIdStr;
  }

  /**
   * Setup Telegram message handlers
   */
  private setupHandlers(): void {
    // Handle channel posts directly from Brook's channel
    this.bot.on('channel_post', async (ctx) => {
      if (this.isFromBrookChannel(ctx)) {
        await this.handleMessage(ctx);
      }
    });

    // Handle messages in Brook's channel (if bot is member)
    this.bot.on('message', async (ctx) => {
      // Check if from Brook's channel
      if (this.isFromBrookChannel(ctx)) {
        await this.handleMessage(ctx);
      }
      // Also accept manual messages from personal chat (user can forward manually)
      else if (this.personalChatId && this.isFromPersonalChat(ctx)) {
        await this.handleMessage(ctx);
      }
    });

    // Handle edited messages
    this.bot.on('edited_message', async (ctx) => {
      if (this.isFromBrookChannel(ctx) || (this.personalChatId && this.isFromPersonalChat(ctx))) {
        await this.handleMessage(ctx);
      }
    });

    // Handle edited channel posts
    this.bot.on('edited_channel_post', async (ctx) => {
      if (this.isFromBrookChannel(ctx)) {
        await this.handleMessage(ctx);
      }
    });
  }

  /**
   * Handle any message (forwarded or regular)
   */
  private async handleMessage(ctx: Context): Promise<void> {
    const message = ctx.message;
    if (!message) return;

    const messageId = message.message_id;
    
    // Avoid processing duplicates
    if (this.processedMessageIds.has(messageId)) {
      return;
    }

    // Extract text from message
    let text = '';
    if ('text' in message && message.text) {
      text = message.text;
    } else if ('caption' in message && message.caption) {
      text = message.caption;
    }

    if (!text) {
      return;
    }

    // Extract token addresses
    const addresses = extractTokenAddresses(text);
    
    if (addresses.length === 0) {
      logger.debug('No token addresses found in message', { messageId });
      return;
    }

    logger.info('Processing Brook call', {
      messageId,
      addressCount: addresses.length,
      addresses: addresses.map(a => a.substring(0, 8) + '...'),
    });

    // Process each address
    for (const address of addresses) {
      try {
        await this.processTokenAddress(address, text, messageId);
      } catch (error) {
        logger.error('Error processing token address', error as Error, {
          address,
          messageId,
        });
      }
    }

    this.processedMessageIds.add(messageId);
    
    // Clean up old message IDs
    if (this.processedMessageIds.size > 1000) {
      const oldestIds = Array.from(this.processedMessageIds).slice(0, 100);
      oldestIds.forEach(id => this.processedMessageIds.delete(id));
    }
  }

  /**
   * Process a single token address
   */
  private async processTokenAddress(
    address: string,
    originalText: string,
    messageId: number
  ): Promise<void> {
    const chain = determineChain(address);
    
    // Fetch token metadata
    const metadata = await fetchTokenMetadata(address, chain);
    
    if (!metadata) {
      logger.warn('Could not fetch token metadata', { address, chain });
      // Still add to database with minimal info
    }

    const tokenSymbol = metadata?.symbol || 'UNKNOWN';
    const tokenName = metadata?.name || 'Unknown Token';
    const price = metadata?.price || 0;

    // Create caller alert
    const alert: CallerAlert = {
      callerName: CALLER_NAME,
      tokenAddress: address,
      tokenSymbol,
      chain,
      alertTimestamp: new Date(),
      alertMessage: originalText.substring(0, 500), // Truncate long messages
      priceAtAlert: price,
      volumeAtAlert: null,
    };

    // Store in database
    try {
      const alertId = await this.callerDb.addCallerAlert(alert);
      logger.info('Stored Brook call in database', {
        alertId,
        tokenSymbol,
        address: address.substring(0, 8) + '...',
        price,
      });

      // Add to live monitoring services
      if (this.liveTradeService && this.liveTradeService.getStatus().isRunning) {
        const alertWithId = { ...alert, id: alertId };
        await this.liveTradeService.addToken(alertWithId);
        logger.info('Added token to live trade service', { tokenSymbol });
      }

      if (this.tenkanKijunService) {
        const alertTime = DateTime.fromJSDate(alert.alertTimestamp);
        await this.tenkanKijunService.addToken(
          address,
          tokenSymbol,
          chain,
          CALLER_NAME,
          alertTime,
          price
        );
        logger.info('Added token to Tenkan/Kijun service', { tokenSymbol });
      }

      // Send confirmation to personal chat (if configured)
      if (this.personalChatId) {
        try {
          await this.bot.telegram.sendMessage(
            this.personalChatId,
            `✅ **Brook Call Ingested**\n\n` +
            `🪙 **${tokenName}** (${tokenSymbol})\n` +
            `📍 **Chain:** ${chain.toUpperCase()}\n` +
            `🔗 **Address:** \`${address}\`\n` +
            `💰 **Price:** $${price.toFixed(8)}\n` +
            `📊 **Status:** ${this.liveTradeService?.getStatus().isRunning ? 'Monitoring' : 'Stored'}`,
            { parse_mode: 'Markdown' }
          );
        } catch (error) {
          logger.warn('Failed to send confirmation message', {
            error: (error as Error).message,
          });
        }
      }
    } catch (error) {
      logger.error('Failed to store Brook call', error as Error, {
        address,
        tokenSymbol,
      });
      throw error;
    }
  }

  /**
   * Start the ingestion service
   */
  public async start(): Promise<void> {
    try {
      logger.info('Starting Brook call ingestion service');
      
      const botInfo = await this.bot.telegram.getMe();
      logger.info('Bot initialized', { username: botInfo.username });

      await this.bot.launch();
      logger.info('Brook call ingestion service started successfully');
    } catch (error) {
      logger.error('Failed to start ingestion service', error as Error);
      throw error;
    }
  }

  /**
   * Stop the ingestion service
   */
  public stop(): void {
    logger.info('Stopping Brook call ingestion service');
    this.bot.stop();
  }
}

export default BrookCallIngestion;

