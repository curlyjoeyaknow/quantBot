/**
 * CurlyJoe Call Ingestion
 * Ingests calls from CurlyJoe Telegram channel, adds them to watchlist
 * and enables live monitoring.
 */

import { Telegraf, Context } from 'telegraf';
import axios from 'axios';
import { logger } from '@quantbot/utils';
import { LiveTradeAlertService } from './live-trade-alert-service';
import { fetchHistoricalCandlesForMonitoring } from '@quantbot/ohlcv';
import type { Candle, EntryConfig } from '@quantbot/core';

const CALLER_NAME = 'curlyjoe';
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || '';

// Default config for trade entry
const DEFAULT_ENTRY_CONFIG: EntryConfig = {
  initialEntry: -0.1,  // Enter after 10% drop from alert price
  trailingEntry: 0.05, // Buy on 5% rebound from low
  maxWaitTime: 60,     // Max 60 minutes wait
};

// Solana watchlist WebSocket size limit
const MAX_SOLANA_WATCHLIST_SIZE = 50;

/**
 * Extracts token addresses (Solana/EVM) from given text.
 */
function extractTokenAddresses(text: string): string[] {
  if (!text) return [];
  let cleanText = text.replace(/<[^>]+>/g, ' ')
                      .replace(/&apos;/g, "'")
                      .replace(/&quot;/g, '"')
                      .replace(/&amp;/g, '&');
  // Solana (32-44 char base58)
  const solanaRegex = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
  const solanaMatches = (cleanText.match(solanaRegex) || [])
    .filter(addr => addr.length >= 32 && addr.length <= 44 && !addr.toUpperCase().startsWith('DEF'));
  // EVM (0x + 40 hex chars)
  const evmRegex = /0x[a-fA-F0-9]{40}\b/g;
  const evmMatches = cleanText.match(evmRegex) || [];
  // Unify and dedupe (EVM toLowerCase)
  const unique = new Set([
    ...solanaMatches,
    ...evmMatches.map(a => a.toLowerCase())
  ]);
  return Array.from(unique);
}

/**
 * Identify blockchain for a token address.
 */
function determineChain(address: string): 'solana' | 'ethereum' | 'bsc' | 'base' {
  // Heuristic: all 0x... addresses assigned to BSC by default
  return address.startsWith('0x') ? 'bsc' : 'solana';
}

/**
 * Fetches token metadata and price from Birdeye API.
 */
async function fetchTokenMetadata(
  address: string,
  chain: string
): Promise<{ name: string; symbol: string; price: number } | null> {
  try {
    const { data } = await axios.get(
      'https://public-api.birdeye.so/defi/token_overview', {
        params: { address },
        headers: {
          'X-API-KEY': BIRDEYE_API_KEY,
          accept: 'application/json',
          'x-chain': chain,
        },
        timeout: 5000,
      }
    );
    if (data?.success && data?.data) {
      const d = data.data;
      return {
        name: d.name || `Token ${address.substring(0, 8)}`,
        symbol: d.symbol || address.substring(0, 4).toUpperCase(),
        price: parseFloat(d.price || '0'),
      };
    }
  } catch (error) {
    logger.debug('Failed to fetch token metadata', {
      address: address.substring(0, 20),
      chain,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return null;
}

/** Minimal type for watchlist limiting/filtering. */
type ActiveMonitoredToken = {
  id: number;
  chain: string;
  alertTimestamp: Date;
};

/**
 * Enforces the Solana watchlist size limit (FIFO removal).
 */
async function enforceWatchlistLimit(chain: string): Promise<void> {
  if (chain !== 'solana') return;
  try {
    const activeTokens = await getActiveMonitoredTokens();
    const solanaTokens = Array.isArray(activeTokens)
      ? activeTokens.filter(t => t?.chain === 'solana')
      : [];
    if (solanaTokens.length > MAX_SOLANA_WATCHLIST_SIZE) {
      const sorted = solanaTokens.sort(
        (a, b) => a.alertTimestamp.getTime() - b.alertTimestamp.getTime()
      );
      for (const token of sorted.slice(0, solanaTokens.length - MAX_SOLANA_WATCHLIST_SIZE)) {
        if (token?.id) await updateMonitoredTokenStatus(token.id, 'removed');
      }
    }
  } catch (error) {
    logger.error('Failed to enforce watchlist limit', error as Error);
  }
}

/**
 * Minimal alert record for DB ingestion.
 */
export type CallerAlert = {
  id: string;
  message: string;
  timestamp: Date;
  // Extend with any custom fields as needed elsewhere.
};

export interface CallerDb {
  addCallerAlert(alert: CallerAlert): Promise<void>;
}

/**
 * Watches CurlyJoe's channel and processes token call messages to the system.
 */
export class CurlyJoeCallIngestion {
  private bot: Telegraf<Context>;
  private callerDb: CallerDb;
  private liveTradeService: LiveTradeAlertService | null = null;
  private processedMessageIds = new Set<number>();
  private curlyjoeChannelId?: string;

  constructor(params: {
    bot: Telegraf<Context>;
    callerDb: CallerDb;
    liveTradeService?: LiveTradeAlertService | null;
    curlyjoeChannelId?: string;
  }) {
    this.bot = params.bot;
    this.callerDb = params.callerDb;
    this.liveTradeService = params.liveTradeService ?? null;
    this.curlyjoeChannelId = params.curlyjoeChannelId;
    this.setupHandlers();
  }

  /** Wires up the Telegram bot message handler for CurlyJoe's channel. */
  private setupHandlers(): void {
    this.bot.on('message', async (ctx: Context) => {
      if (
        typeof this.isFromCurlyJoeChannel === 'function' &&
        typeof this.handleMessage === 'function'
      ) {
        if (this.isFromCurlyJoeChannel(ctx)) {
          await this.handleMessage(ctx);
        }
      }
    });
  }

  /** Verifies if the context is from the configured CurlyJoe channel. */
  private isFromCurlyJoeChannel(ctx: Context): boolean {
    if (!this.curlyjoeChannelId) return false;
    return ctx.chat?.id?.toString() === this.curlyjoeChannelId;
  }

  /**
   * Handles and processes a new message from CurlyJoe.
   */
  private async handleMessage(ctx: Context): Promise<void> {
    const msg = ctx.message as { text?: string; caption?: string; message_id?: number } | undefined;
    const text: string =
      typeof msg?.text === 'string'
        ? msg.text
        : typeof msg?.caption === 'string'
        ? msg.caption
        : '';

    const addresses = extractTokenAddresses(text);
    if (!addresses.length) return;

    logger.info('Processing CurlyJoe call', { addressCount: addresses.length });
    for (const address of addresses) {
      try {
        await this.processTokenAddress(address, text);
      } catch (error: unknown) {
        logger.error(
          'Error processing token address from CurlyJoe',
          error instanceof Error ? error : new Error(String(error)),
          { address }
        );
      }
    }
    // Track processed Telegram message IDs (deduplication/window)
    if (msg?.message_id !== undefined) {
      this.processedMessageIds.add(msg.message_id);
      // Remove oldest if exceeding buffer size
      if (this.processedMessageIds.size > 1000) {
        const oldestIds = Array.from(this.processedMessageIds).slice(0, 100);
        oldestIds.forEach((id) => this.processedMessageIds.delete(id));
      }
    }
  }

  /**
   * Handles ingestion and live monitoring for a detected token address.
   */
  private async processTokenAddress(
    address: string,
    originalText: string
  ): Promise<void> {
    const text = originalText.substring(0, 500);
    const chain = determineChain(address);

    // Step 1: fetch metadata
    const metadata = await fetchTokenMetadata(address, chain);
    if (!metadata) {
      logger.warn('Failed to fetch token metadata', { address: address.substring(0, 20) });
      return;
    }
    if (metadata.price <= 0) {
      logger.warn('Token has invalid price', {
        address: address.substring(0, 20),
        price: metadata.price,
      });
      return;
    }

    // Step 2: form alert object for DB
    interface FullCallerAlert {
      callerName: string;
      tokenAddress: string;
      tokenSymbol: string;
      chain: string;
      alertTimestamp: Date;
      alertMessage: string;
      priceAtAlert: number;
      createdAt: Date;
    }
    const alert: FullCallerAlert = {
      callerName: CALLER_NAME,
      tokenAddress: address,
      tokenSymbol: metadata.symbol,
      chain,
      alertTimestamp: new Date(),
      alertMessage: text,
      priceAtAlert: metadata.price,
      createdAt: new Date(),
    };

    // Step 3: Store in caller DB (id/message/timestamp: for DB contract)
    try {
      const dbAlert = {
        ...alert,
        id: crypto.randomUUID(),
        message: alert.alertMessage,
        timestamp: alert.alertTimestamp,
      };
      await this.callerDb.addCallerAlert(dbAlert);
      logger.info('Stored CurlyJoe call in database', {
        tokenSymbol: metadata.symbol,
        address: address.substring(0, 20),
      });
    } catch (error) {
      logger.warn('Failed to store CurlyJoe call', {
        error: error instanceof Error ? error.message : String(error),
        address: address.substring(0, 20),
      });
      // Continue so monitoring/watchlist isn't blocked on duplication/store issues
    }

    // Step 4: Enforce Solana-specific watchlist size limit
    await enforceWatchlistLimit(chain);

    // Step 5: Fetch historical candles for monitoring
    let historicalCandles: unknown[] = [];
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
      // Proceed with empty candle set if fetch fails
    }

    // Step 6: Forward to live trade monitor, if enabled
    if (this.liveTradeService) {
      try {
        await this.liveTradeService.addToken(
          alert,
          DEFAULT_ENTRY_CONFIG,
          historicalCandles as Candle[]
        );
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

    // Step 7: Store in persistent watchlist
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

  /** Starts the Telegram bot and monitoring ingestion service. */
  async start(): Promise<void> {
    logger.info('Starting CurlyJoe call ingestion service', {
      channelId: this.curlyjoeChannelId,
    });
    await this.bot.launch();
    logger.info('CurlyJoe call ingestion service started');
  }

  /** Stops the Telegram bot and monitoring ingestion service. */
  async stop(): Promise<void> {
    logger.info('Stopping CurlyJoe call ingestion service');
    await this.bot.stop();
    logger.info('CurlyJoe call ingestion service stopped');
  }
}

// --- Stubs for required (not implemented) persistence/monitor helpers ---

/**
 * Gets currently watched tokens.
 */
async function getActiveMonitoredTokens(): Promise<ActiveMonitoredToken[]> {
  throw new Error('Function not implemented.');
}

/**
 * Changes status of a watched token (e.g. for FIFO removal).
 */
async function updateMonitoredTokenStatus(id: number, status: string): Promise<void> {
  throw new Error('Function not implemented.');
}

/**
 * Persists a token in the main alert/watchlist DB.
 */
async function storeMonitoredToken(arg0: {
  tokenAddress: string;
  chain: string;
  tokenSymbol: string;
  callerName: string;
  alertTimestamp: Date;
  alertPrice: number;
  entryConfig: EntryConfig;
  status: string;
  historicalCandlesCount: number;
}): Promise<void> {
  throw new Error('Function not implemented.');
}
