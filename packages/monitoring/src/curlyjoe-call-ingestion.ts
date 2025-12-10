/**
 * CurlyJoe Call Ingestion Module
 * ===============================
 * Automatically ingests calls from CurlyJoe channel and adds them to watchlist
 * with live monitoring enabled.
 */

import { Telegraf, Context } from 'telegraf';
import { DateTime } from 'luxon';
import axios from 'axios';
import { logger } from '@quantbot/utils';
import { CallerDatabase, type CallerAlert } from '@quantbot/storage';
import { LiveTradeAlertService } from './live-trade-alert-service';
import { fetchHistoricalCandlesForMonitoring } from '@quantbot/services';
import { storeMonitoredToken } from '@quantbot/utils';
import { getActiveMonitoredTokens, updateMonitoredTokenStatus } from '@quantbot/utils';
import { EntryConfig } from '@quantbot/simulation/config';

const CALLER_NAME = 'curlyjoe';
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || '';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '';
const CURLYJOE_CHANNEL_ID = process.env.CURLYJOE_CHANNEL_ID || '';

// Default entry configuration
const DEFAULT_ENTRY_CONFIG: EntryConfig = {
  initialEntry: -0.1, // Wait for 10% price drop from alert price
  trailingEntry: 0.05, // Enter on 5% rebound from low
  maxWaitTime: 60, // 60 minutes max wait
};

// Max watchlist size for Solana tokens (WebSocket limit)
const MAX_SOLANA_WATCHLIST_SIZE = 50;

/**
 * Extract token addresses from text (reuse from brook-call-ingestion)
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
    return 'bsc'; // Default to BSC for EVM addresses
  }
  return 'solana';
}

/**
 * Fetch token metadata and price
 */
async function fetchTokenMetadata(
  address: string,
  chain: string
): Promise<{ name: string; symbol: string; price: number } | null> {
  try {
    const response = await axios.get(
      `https://public-api.birdeye.so/defi/token_overview`,
      {
        params: { address },
        headers: {
          'X-API-KEY': BIRDEYE_API_KEY,
          'accept': 'application/json',
          'x-chain': chain,
        },
        timeout: 5000,
      }
    );

    if (response.data?.success && response.data?.data) {
      const data = response.data.data;
      return {
        name: data.name || `Token ${address.substring(0, 8)}`,
        symbol: data.symbol || address.substring(0, 4).toUpperCase(),
        price: parseFloat(data.price || '0'),
      };
    }
  } catch (error) {
    logger.debug('Failed to fetch token metadata', {
      address: address.substring(0, 20),
      chain,
    });
  }

  return null;
}

/**
 * Ensure Solana watchlist doesn't exceed max size (FIFO removal)
 * ETH/BSC tokens are not limited (RPC polling has 100 calls/sec limit)
 */
async function enforceWatchlistLimit(chain: string): Promise<void> {
  // Only enforce limit for Solana tokens
  if (chain !== 'solana') {
    return;
  }

  try {
    const activeTokens = await getActiveMonitoredTokens();
    const solanaTokens = activeTokens.filter(t => t.chain === 'solana');
    
    if (solanaTokens.length > MAX_SOLANA_WATCHLIST_SIZE) {
      // Sort by created_at (oldest first) and remove excess Solana tokens
      const sorted = solanaTokens.sort((a, b) => 
        a.alertTimestamp.getTime() - b.alertTimestamp.getTime()
      );
      
      const toRemove = sorted.slice(0, solanaTokens.length - MAX_SOLANA_WATCHLIST_SIZE);
      
      logger.info('Removing oldest Solana tokens from watchlist to enforce limit', {
        currentSolanaCount: solanaTokens.length,
        maxSolanaSize: MAX_SOLANA_WATCHLIST_SIZE,
        totalTokens: activeTokens.length,
        removingCount: toRemove.length,
      });
      
      for (const token of toRemove) {
        if (token.id) {
          await updateMonitoredTokenStatus(token.id, 'removed');
        }
      }
    }
  } catch (error) {
    logger.error('Failed to enforce watchlist limit', error as Error);
  }
}

/**
 * CurlyJoe Call Ingestion Service
 */
export class CurlyJoeCallIngestion {
  private bot: Telegraf;
  private callerDb: CallerDatabase;
  private liveTradeService: LiveTradeAlertService | null = null;
  private processedMessageIds: Set<number> = new Set();
  private curlyjoeChannelId: string;

  constructor(
    botToken: string,
    curlyjoeChannelId: string,
    liveTradeService?: LiveTradeAlertService
  ) {
    this.bot = new Telegraf(botToken);
    this.callerDb = new CallerDatabase();
    this.curlyjoeChannelId = curlyjoeChannelId;
    this.liveTradeService = liveTradeService || null;
    
    this.setupHandlers();
  }

  /**
   * Check if message is from CurlyJoe channel
   */
  private isFromCurlyJoeChannel(ctx: Context): boolean {
    const chatId = ctx.chat?.id;
    if (!chatId) return false;
    
    // Check if message is forwarded from CurlyJoe channel
    const forwardFromChat = ctx.message && 'forward_from_chat' in ctx.message 
      ? (ctx.message as any).forward_from_chat as { id?: number | string }
      : null;
    
    if (forwardFromChat?.id && forwardFromChat.id.toString() === this.curlyjoeChannelId) {
      return true;
    }
    
    // Also check direct channel messages
    if (chatId.toString() === this.curlyjoeChannelId) {
      return true;
    }
    
    return false;
  }

  /**
   * Setup message handlers
   */
  private setupHandlers(): void {
    // Listen for messages (forwarded or direct)
    this.bot.on('message', async (ctx) => {
      if (this.isFromCurlyJoeChannel(ctx)) {
        await this.handleMessage(ctx);
      }
    });
  }

  /**
   * Handle message from CurlyJoe channel
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
      logger.debug('No token addresses found in CurlyJoe message', { messageId });
      return;
    }

    logger.info('Processing CurlyJoe call', {
      messageId,
      addressCount: addresses.length,
      addresses: addresses.map(a => a.substring(0, 8) + '...'),
    });

    // Process each address
    for (const address of addresses) {
      try {
        await this.processTokenAddress(address, text, messageId);
      } catch (error) {
        logger.error('Error processing token address from CurlyJoe', error as Error, {
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
   * Process a single token address and add to watchlist
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
      logger.warn('Failed to fetch token metadata', { address: address.substring(0, 20) });
      return;
    }

    if (metadata.price <= 0) {
      logger.warn('Token has invalid price', { address: address.substring(0, 20), price: metadata.price });
      return;
    }

    // Create caller alert
    const alert: CallerAlert = {
      callerName: CALLER_NAME,
      tokenAddress: address,
      tokenSymbol: metadata.symbol,
      chain,
      alertTimestamp: new Date(),
      alertMessage: originalText.substring(0, 500), // Limit message length
      priceAtAlert: metadata.price,
      createdAt: new Date(),
    };

    // Store in caller database
    try {
      await this.callerDb.addCallerAlert(alert);
      logger.info('Stored CurlyJoe call in database', {
        tokenSymbol: metadata.symbol,
        address: address.substring(0, 20),
      });
    } catch (error) {
      logger.warn('Failed to store CurlyJoe call', {
        error: error instanceof Error ? error.message : String(error),
        address: address.substring(0, 20),
      });
      // Continue anyway - might be duplicate
    }

    // Enforce watchlist limit before adding (Solana only)
    await enforceWatchlistLimit(chain);

    // Fetch historical candles
    let historicalCandles: any[] = [];
    try {
      historicalCandles = await fetchHistoricalCandlesForMonitoring(
        address,
        chain,
        alert.alertTimestamp
      );
      logger.info('Fetched historical candles for CurlyJoe call', {
        address: address.substring(0, 20),
        candleCount: historicalCandles.length,
      });
    } catch (error) {
      logger.warn('Failed to fetch historical candles', {
        error: error instanceof Error ? error.message : String(error),
        address: address.substring(0, 20),
      });
      // Continue without historical candles
    }

    // Add to live monitoring service
    if (this.liveTradeService) {
      try {
        await this.liveTradeService.addToken(alert, DEFAULT_ENTRY_CONFIG, historicalCandles);
        logger.info('Added CurlyJoe call to live monitoring', {
          tokenSymbol: metadata.symbol,
          address: address.substring(0, 20),
        });
      } catch (error) {
        logger.error('Failed to add to live monitoring', error as Error, {
          address: address.substring(0, 20),
        });
      }
    }

    // Store in Postgres watchlist
    try {
      await storeMonitoredToken({
        tokenAddress: address,
        chain,
        tokenSymbol: metadata.symbol,
        callerName: CALLER_NAME,
        alertTimestamp: alert.alertTimestamp,
        alertPrice: metadata.price,
        entryConfig: DEFAULT_ENTRY_CONFIG,
        status: 'active',
        historicalCandlesCount: historicalCandles.length,
      });
      logger.info('Added CurlyJoe call to watchlist', {
        tokenSymbol: metadata.symbol,
        address: address.substring(0, 20),
      });
    } catch (error) {
      logger.error('Failed to store in watchlist', error as Error, {
        address: address.substring(0, 20),
      });
    }
  }

  /**
   * Start the ingestion service
   */
  async start(): Promise<void> {
    logger.info('Starting CurlyJoe call ingestion service', {
      channelId: this.curlyjoeChannelId,
    });
    
    await this.bot.launch();
    logger.info('CurlyJoe call ingestion service started');
  }

  /**
   * Stop the ingestion service
   */
  async stop(): Promise<void> {
    logger.info('Stopping CurlyJoe call ingestion service');
    await this.bot.stop();
    logger.info('CurlyJoe call ingestion service stopped');
  }
}

