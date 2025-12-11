/**
 * OHLCV Ingestion Engine
 * =======================
 * Core engine for fetching, caching, and managing OHLCV candle data from Birdeye.
 * 
 * Features:
 * - Multi-layer caching (in-memory LRU, ClickHouse) to minimize API calls
 * - Intelligent fetching strategy for 1m and 5m candles around alert times
 * - Automatic chunking for large data requests (5000 candles max per API call)
 * - Incremental storage: stores data immediately after each fetch to prevent data loss
 * - Metadata enrichment: fetches and stores token metadata before candle data
 * 
 * Fetching Strategy:
 * - 1m candles: -52 minutes before alert, up to 5000 candles
 * - 5m candles: -260 minutes (5*52) before alert, up to current time, in chunks of 5000
 */

import { DateTime } from 'luxon';
import { birdeyeClient } from '@quantbot/api-clients';
import { insertCandles, queryCandles, initClickHouse, TokensRepository } from '@quantbot/storage';
import type { Candle, Chain } from '@quantbot/core';
import { logger } from '@quantbot/utils';
import { LRUCache } from 'lru-cache';

// --- Interfaces ---

export interface OhlcvIngestionOptions {
  /**
   * Use cache (in-memory and ClickHouse) before making API calls
   * @default true
   */
  useCache?: boolean;
  
  /**
   * Force refresh even if data exists in cache
   * @default false
   */
  forceRefresh?: boolean;
}

export interface OhlcvIngestionResult {
  '1m': Candle[];
  '5m': Candle[];
  metadata: {
    tokenStored: boolean;
    total1mCandles: number;
    total5mCandles: number;
    chunksFetched: number;
    chunksFromCache: number;
    chunksFromAPI: number;
  };
}

// --- Cache Implementation ---

const cacheOptions = {
  max: 500, // Max 500 cached items
  ttl: 1000 * 60 * 5, // 5 minute TTL
};

const cache = new LRUCache<string, Candle[]>(cacheOptions);

function getCacheKey(mint: string, interval: '1m' | '5m', startTime: DateTime, endTime: DateTime): string {
  return `${mint}:${interval}:${Math.floor(startTime.toSeconds())}:${Math.floor(endTime.toSeconds())}`;
}

// --- OHLCV Ingestion Engine ---

export class OhlcvIngestionEngine {
  private clickhouseInitialized = false;
  private tokensRepo = new TokensRepository();

  /**
   * Initialize the engine (ensure ClickHouse is ready)
   */
  async initialize(): Promise<void> {
    if (!this.clickhouseInitialized) {
      try {
        await initClickHouse();
        this.clickhouseInitialized = true;
        logger.info('[OhlcvIngestionEngine] ClickHouse initialized');
      } catch (error) {
        logger.error('[OhlcvIngestionEngine] Failed to initialize ClickHouse', error as Error);
        throw error;
      }
    }
  }

  /**
   * Main entry point for fetching candles with the new strategy
   * 
   * @param mint Token mint address (full address, case-preserved)
   * @param chain Blockchain name (defaults to 'solana')
   * @param alertTime Alert timestamp - used to calculate fetch windows
   * @param options Ingestion options
   * @returns Object containing 1m and 5m candles, plus metadata
   */
  async fetchCandles(
    mint: string,
    chain: Chain,
    alertTime: DateTime,
    options: OhlcvIngestionOptions = {}
  ): Promise<OhlcvIngestionResult> {
    await this.initialize();

    const metadata = {
      tokenStored: false,
      total1mCandles: 0,
      total5mCandles: 0,
      chunksFetched: 0,
      chunksFromCache: 0,
      chunksFromAPI: 0,
    };

    try {
      // Step 1: Fetch and store metadata first (enrich token details)
      logger.info(`[OhlcvIngestionEngine] Fetching metadata for ${mint.substring(0, 20)}...`);
      metadata.tokenStored = await this._fetchAndStoreMetadata(mint, chain);

      // Step 2: Fetch 1m candles (-52 minutes before alert, max 5000 candles)
      logger.info(`[OhlcvIngestionEngine] Fetching 1m candles for ${mint.substring(0, 20)}...`);
      const oneMinuteResult = await this._fetch1mCandles(mint, chain, alertTime, options);
      metadata.total1mCandles = oneMinuteResult.candles.length;
      metadata.chunksFetched += oneMinuteResult.chunksFetched;
      metadata.chunksFromCache += oneMinuteResult.chunksFromCache;
      metadata.chunksFromAPI += oneMinuteResult.chunksFromAPI;

      // Step 3: Fetch 5m candles (-260 minutes before alert, up to current time, in chunks)
      logger.info(`[OhlcvIngestionEngine] Fetching 5m candles for ${mint.substring(0, 20)}...`);
      const fiveMinuteResult = await this._fetch5mCandles(mint, chain, alertTime, options);
      metadata.total5mCandles = fiveMinuteResult.candles.length;
      metadata.chunksFetched += fiveMinuteResult.chunksFetched;
      metadata.chunksFromCache += fiveMinuteResult.chunksFromCache;
      metadata.chunksFromAPI += fiveMinuteResult.chunksFromAPI;

      logger.info(`[OhlcvIngestionEngine] Completed fetch for ${mint.substring(0, 20)}...`, {
        '1m': metadata.total1mCandles,
        '5m': metadata.total5mCandles,
        chunksFromCache: metadata.chunksFromCache,
        chunksFromAPI: metadata.chunksFromAPI,
      });

      return {
        '1m': oneMinuteResult.candles,
        '5m': fiveMinuteResult.candles,
        metadata,
      };
    } catch (error) {
      logger.error(`[OhlcvIngestionEngine] Failed to fetch candles for ${mint.substring(0, 20)}...`, error as Error);
      throw error;
    }
  }

  /**
   * Fetch and store token metadata
   * CRITICAL: Preserves full mint address and exact case
   */
  private async _fetchAndStoreMetadata(mint: string, chain: Chain): Promise<boolean> {
    try {
      const metadata = await birdeyeClient.getTokenMetadata(mint, chain);
      if (metadata) {
        // Store metadata in PostgreSQL using TokensRepository
        // This enriches the token details before inserting OHLCV candles
        await this.tokensRepo.getOrCreateToken(chain, mint, {
          name: metadata.name,
          symbol: metadata.symbol,
        });
        logger.debug(`[OhlcvIngestionEngine] Metadata stored for ${mint.substring(0, 20)}...`);
        return true;
      }
      logger.warn(`[OhlcvIngestionEngine] No metadata returned for ${mint.substring(0, 20)}...`);
      return false;
    } catch (error) {
      logger.error(`[OhlcvIngestionEngine] Failed to fetch or store metadata for ${mint.substring(0, 20)}...`, error as Error);
      // Don't throw - metadata fetch failure shouldn't block candle fetching
      return false;
    }
  }

  /**
   * Fetch 1-minute candles
   * Strategy: -52 minutes before alert, up to 5000 candles (max API limit)
   */
  private async _fetch1mCandles(
    mint: string,
    chain: Chain,
    alertTime: DateTime,
    options: OhlcvIngestionOptions
  ): Promise<{ candles: Candle[]; chunksFetched: number; chunksFromCache: number; chunksFromAPI: number }> {
    const startTime = alertTime.minus({ minutes: 52 });
    // 5000 candles = 5000 minutes = ~83 hours, but we'll cap at a reasonable window
    const endTime = startTime.plus({ minutes: 5000 });

    const result = await this._fetchAndStoreChunk({
      mint,
      chain,
      interval: '1m',
      startTime,
      endTime,
      options,
    });

    return {
      candles: result.candles,
      chunksFetched: 1,
      chunksFromCache: result.fromCache ? 1 : 0,
      chunksFromAPI: result.fromCache ? 0 : 1,
    };
  }

  /**
   * Fetch 5-minute candles
   * Strategy: -260 minutes (5*52) before alert, up to current time, in chunks of 5000 candles
   */
  private async _fetch5mCandles(
    mint: string,
    chain: Chain,
    alertTime: DateTime,
    options: OhlcvIngestionOptions
  ): Promise<{ candles: Candle[]; chunksFetched: number; chunksFromCache: number; chunksFromAPI: number }> {
    const startTime = alertTime.minus({ minutes: 5 * 52 }); // -260 minutes
    const now = DateTime.utc();

    const allCandles: Candle[] = [];
    let currentStartTime = startTime;
    let chunksFetched = 0;
    let chunksFromCache = 0;
    let chunksFromAPI = 0;

    // Fetch in chunks of 5000 candles (5000 * 5 minutes = 25000 minutes = ~17 days per chunk)
    while (currentStartTime < now) {
      const chunkEndTime = currentStartTime.plus({ minutes: 5000 * 5 }); // 5000 5m candles
      const endTime = chunkEndTime > now ? now : chunkEndTime;

      const result = await this._fetchAndStoreChunk({
        mint,
        chain,
        interval: '5m',
        startTime: currentStartTime,
        endTime,
        options,
      });

      chunksFetched++;

      if (result.fromCache) {
        chunksFromCache++;
      } else {
        chunksFromAPI++;
      }

      if (result.candles.length === 0) {
        // No more data available
        break;
      }

      // Store chunk immediately to prevent data loss on script failure
      allCandles.push(...result.candles);

      // Move to next chunk (start from last candle timestamp + 5 minutes)
      if (result.candles.length > 0) {
        const lastCandleTime = DateTime.fromSeconds(result.candles[result.candles.length - 1].timestamp);
        currentStartTime = lastCandleTime.plus({ minutes: 5 });
      } else {
        // No candles in this chunk, advance by chunk size
        currentStartTime = endTime;
      }

      // Safety check: if we've fetched too many chunks, break
      if (chunksFetched > 100) {
        logger.warn(`[OhlcvIngestionEngine] Too many chunks fetched for ${mint.substring(0, 20)}..., stopping`);
        break;
      }
    }

    return {
      candles: allCandles,
      chunksFetched,
      chunksFromCache,
      chunksFromAPI,
    };
  }

  /**
   * Core fetch and store logic for a single chunk of candles
   * CRITICAL: Stores data immediately after fetching to prevent data loss
   */
  private async _fetchAndStoreChunk(params: {
    mint: string;
    chain: Chain;
    interval: '1m' | '5m';
    startTime: DateTime;
    endTime: DateTime;
    options: OhlcvIngestionOptions;
  }): Promise<{ candles: Candle[]; fromCache: boolean }> {
    const { mint, chain, interval, startTime, endTime, options } = params;
    const useCache = options.useCache !== false; // Default to true
    const forceRefresh = options.forceRefresh === true; // Default to false
    const cacheKey = getCacheKey(mint, interval, startTime, endTime);

    // Step 1: Check in-memory cache
    if (useCache && !forceRefresh) {
      const cachedCandles = cache.get(cacheKey);
      if (cachedCandles && cachedCandles.length > 0) {
        logger.debug(`[OhlcvIngestionEngine] In-memory cache hit for ${mint.substring(0, 20)}... (${interval})`);
        return { candles: cachedCandles, fromCache: true };
      }
    }

    // Step 2: Check ClickHouse cache
    if (useCache && !forceRefresh) {
      try {
        const dbCandles = await queryCandles(mint, chain, startTime, endTime, interval);
        if (dbCandles.length > 0) {
          logger.debug(`[OhlcvIngestionEngine] ClickHouse cache hit for ${mint.substring(0, 20)}... (${interval}, ${dbCandles.length} candles)`);
          // Store in in-memory cache for faster subsequent access
          cache.set(cacheKey, dbCandles);
          return { candles: dbCandles, fromCache: true };
        }
      } catch (error) {
        logger.warn(`[OhlcvIngestionEngine] ClickHouse query failed, falling back to API`, {
          error: (error as Error).message,
          mint: mint.substring(0, 20),
        });
      }
    }

    // Step 3: Fetch from Birdeye API
    logger.info(`[OhlcvIngestionEngine] Fetching ${interval} candles from Birdeye for ${mint.substring(0, 20)}...`, {
      startTime: startTime.toISO(),
      endTime: endTime.toISO(),
    });

    try {
      const birdeyeData = await birdeyeClient.fetchOHLCVData(
        mint,
        startTime.toJSDate(),
        endTime.toJSDate(),
        interval,
        chain
      );

      if (!birdeyeData || !birdeyeData.items || birdeyeData.items.length === 0) {
        logger.debug(`[OhlcvIngestionEngine] No data returned from Birdeye for ${mint.substring(0, 20)}...`);
        return { candles: [], fromCache: false };
      }

      // Convert Birdeye format to Candle format
      const candles: Candle[] = birdeyeData.items
        .map((item) => ({
          timestamp: item.unixTime,
          open: item.open,
          high: item.high,
          low: item.low,
          close: item.close,
          volume: item.volume,
        }))
        .filter((candle) => {
          // Filter candles within the requested time range
          const candleTime = DateTime.fromSeconds(candle.timestamp);
          return candleTime >= startTime && candleTime <= endTime;
        })
        .sort((a, b) => a.timestamp - b.timestamp); // Ensure chronological order

      if (candles.length === 0) {
        logger.debug(`[OhlcvIngestionEngine] No candles in time range for ${mint.substring(0, 20)}...`);
        return { candles: [], fromCache: false };
      }

      // Step 4: Store immediately to prevent data loss on script failure
      // CRITICAL: Store to ClickHouse first (persistent storage)
      try {
        await insertCandles(mint, chain, candles, interval);
        logger.debug(`[OhlcvIngestionEngine] Stored ${candles.length} ${interval} candles to ClickHouse for ${mint.substring(0, 20)}...`);
      } catch (error) {
        logger.error(`[OhlcvIngestionEngine] Failed to store candles to ClickHouse`, error as Error, {
          mint: mint.substring(0, 20),
          interval,
          candleCount: candles.length,
        });
        // Continue even if storage fails - at least we have the data in memory
      }

      // Step 5: Store in in-memory cache for faster subsequent access
      cache.set(cacheKey, candles);

      logger.info(`[OhlcvIngestionEngine] Fetched and stored ${candles.length} ${interval} candles for ${mint.substring(0, 20)}...`);
      return { candles, fromCache: false };
    } catch (error) {
      logger.error(`[OhlcvIngestionEngine] Failed to fetch candles from Birdeye`, error as Error, {
        mint: mint.substring(0, 20),
        interval,
        startTime: startTime.toISO(),
        endTime: endTime.toISO(),
      });
      throw error;
    }
  }

  /**
   * Clear in-memory cache
   */
  clearCache(): void {
    cache.clear();
    logger.debug('[OhlcvIngestionEngine] In-memory cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    inMemoryEntries: number;
    cacheSize: number;
  } {
    let totalSize = 0;
    cache.forEach((candles) => {
      totalSize += candles.length;
    });

    return {
      inMemoryEntries: cache.size,
      cacheSize: totalSize,
    };
  }
}

// Export singleton instance
let engineInstance: OhlcvIngestionEngine | null = null;

/**
 * Get the singleton OHLCV Ingestion Engine instance
 */
export function getOhlcvIngestionEngine(): OhlcvIngestionEngine {
  if (!engineInstance) {
    engineInstance = new OhlcvIngestionEngine();
  }
  return engineInstance;
}

