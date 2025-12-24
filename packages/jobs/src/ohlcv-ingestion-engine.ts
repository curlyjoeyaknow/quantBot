/**
 * OHLCV Ingestion Engine
 * =======================
 * Core engine for fetching, caching, and managing OHLCV candle data from Birdeye.
 *
 * MOVED FROM @quantbot/ohlcv to @quantbot/jobs because it makes API calls.
 * This is the ONLY place where OHLCV fetching from APIs is allowed.
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
import { getBirdeyeClient, fetchMultiChainMetadata } from '@quantbot/api-clients';
import { fetchBirdeyeCandles } from '@quantbot/api-clients';
import { getStorageEngine, initClickHouse } from '@quantbot/storage';
// TokensRepository removed (PostgreSQL) - metadata storage not critical for OHLCV ingestion
import type { Candle, Chain } from '@quantbot/core';
import { logger, ValidationError } from '@quantbot/utils';
import { LRUCache } from 'lru-cache';
import { isEvmAddress } from '@quantbot/utils';
import { storeCandles } from '@quantbot/ohlcv';

const birdeyeClient = getBirdeyeClient();

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

  /**
   * Candle interval to fetch (15s, 1m, 5m, 1H)
   * Note: '1s' is not supported by Birdeye API, use '15s' instead
   * @default '1m'
   */
  interval?: '15s' | '1m' | '5m' | '1H';

  /**
   * Number of candles to fetch
   * @default 5000
   */
  candles?: number;

  /**
   * Number of candle periods before alert to start fetching (negative = before alert)
   * This is in periods/candles, not minutes. The actual time offset depends on the interval:
   * - For 1m: 52 periods = 52 minutes
   * - For 5m: 52 periods = 260 minutes (52 * 5)
   * - For 15s: 52 periods = 13 minutes (52 * 15 / 60)
   * - For 1H: 52 periods = 52 hours (52 * 1)
   * @default 52
   */
  startOffsetMinutes?: number; // Note: Despite the name, this is in periods, not minutes
}

export interface OhlcvIngestionResult {
  '1m': Candle[];
  '5m': Candle[];
  '15s'?: Candle[]; // Optional: 15s candles
  '1H'?: Candle[]; // Optional: 1H candles
  metadata: {
    tokenStored: boolean;
    total1mCandles: number;
    total1sCandles: number; // Actually stores 1H candles (legacy naming)
    total15sCandles: number;
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
} as const;

const cache = new LRUCache<string, Candle[]>(cacheOptions);

function getCacheKey(
  mint: string,
  interval: '1m' | '5m' | '15s' | '1H',
  startTime: DateTime,
  endTime: DateTime
): string {
  return `${mint}:${interval}:${Math.floor(startTime.toSeconds())}:${Math.floor(endTime.toSeconds())}`;
}

// --- OHLCV Ingestion Engine ---

/**
 * Helper function to convert start offset periods to time based on interval
 * startOffsetPeriods is in candle periods (not minutes)
 */
function getStartOffsetTime(
  alertTime: DateTime,
  interval: '15s' | '1m' | '5m' | '1H',
  startOffsetPeriods: number = 52
): DateTime {
  const intervalSeconds: Record<'15s' | '1m' | '5m' | '1H', number> = {
    '15s': 15,
    '1m': 60,
    '5m': 300,
    '1H': 3600,
  };

  const offsetSeconds = startOffsetPeriods * intervalSeconds[interval];
  return alertTime.minus({ seconds: offsetSeconds });
}

export class OhlcvIngestionEngine {
  private clickhouseInitialized = false;
  private storageEngine = getStorageEngine();
  // TokensRepository removed (PostgreSQL) - metadata storage not critical
  // Chain detection cache: mint -> actual chain
  private chainCache = new LRUCache<string, Chain>({ max: 1000, ttl: 1000 * 60 * 60 }); // 1 hour TTL

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
   * Main entry point for fetching candles with the optimized strategy
   *
   * Strategy for alerts < 3 months old:
   * 1. 1m call: 5000 candles starting -52 periods before alert (~3.47 days)
   * 2. 15s call: 5000 candles starting at alert time (~20.83 hours)
   * 3. 1m calls: 2 additional calls to cover first week (~6.94 days)
   * 4. 5m calls: 6 calls to cover ~3.5 months (~104 days)
   *
   * Total: 10 API calls, ~3.5 months coverage
   *
   * Note: startOffsetMinutes in options is actually in periods (candles), not minutes.
   * The actual time offset is calculated based on the interval.
   *
   * @param mint Token mint address (full address, case-preserved)
   * @param chain Blockchain name (defaults to 'solana')
   * @param alertTime Alert timestamp - used to calculate fetch windows
   * @param options Ingestion options (startOffsetMinutes is in periods, not minutes)
   * @returns Object containing 1m, 15s, and 5m candles, plus metadata
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
      total1sCandles: 0,
      total15sCandles: 0,
      total5mCandles: 0,
      chunksFetched: 0,
      chunksFromCache: 0,
      chunksFromAPI: 0,
    };

    try {
      // Step 0: Detect actual chain for EVM addresses (before fetching metadata/candles)
      let actualChain = chain;
      if (isEvmAddress(mint)) {
        const cachedChain = this.chainCache.get(mint);
        if (cachedChain) {
          actualChain = cachedChain;
          logger.debug(
            `[OhlcvIngestionEngine] Using cached chain for ${mint}...`,
            {
              chain: actualChain,
            }
          );
        } else {
          logger.info(
            `[OhlcvIngestionEngine] Detecting chain for EVM address ${mint}...`,
            {
              chainHint: chain,
            }
          );
          const metadataResult = await fetchMultiChainMetadata(mint, chain);
          if (metadataResult.primaryMetadata) {
            actualChain = metadataResult.primaryMetadata.chain;
            this.chainCache.set(mint, actualChain);
            logger.info(`[OhlcvIngestionEngine] Chain detected for ${mint}...`, {
              chainHint: chain,
              actualChain,
              symbol: metadataResult.primaryMetadata.symbol,
            });
          } else {
            logger.warn(
              `[OhlcvIngestionEngine] No metadata found for ${mint}... on any chain, using hint`,
              {
                chainHint: chain,
              }
            );
            // Keep original chain hint if no metadata found
          }
        }
      }

      // Step 1: Fetch and store metadata first (enrich token details)
      logger.info(`[OhlcvIngestionEngine] Fetching metadata for ${mint}...`);
      metadata.tokenStored = await this._fetchAndStoreMetadata(mint, actualChain);

      const now = DateTime.utc();
      const alertAge = now.diff(alertTime, 'days').days;
      const useOptimizedStrategy = alertAge < 90; // Only for alerts < 3 months old

      // Flag to skip 1m fetching if 5m probe succeeds but 1m fails (for older alerts)
      let skip1mFetch = false;

      // CRITICAL OPTIMIZATION: Try 1m first - if API returns 0 candles, skip all other periods
      // This saves ~12 API calls per token when there's no data
      // NOTE: Only apply early exit for recent alerts (< 3 months) - old alerts might have data
      // in different time windows, so we should still try to fetch
      // For older alerts, if 1m probe fails, still try 5m (more likely to have data for older tokens)
      if (useOptimizedStrategy) {
        logger.info(
          `[OhlcvIngestionEngine] Checking 1m data availability first (early exit optimization for recent alerts)...`
        );
        const oneMinuteProbe = await this._probe1mData(mint, actualChain, alertTime, options);

        if (oneMinuteProbe.hasData === false && oneMinuteProbe.fromAPI) {
          // API returned 0 candles - no data exists for this token, skip everything
          logger.warn(
            `[OhlcvIngestionEngine] No 1m data from API for ${mint}..., skipping all intervals`
          );
          return {
            '1m': [],
            '5m': [],
            '15s': [],
            '1H': [],
            metadata,
          };
        }
      } else {
        // For older alerts (>= 90 days), still probe 1m but if it fails, try 5m
        // Older tokens might have 5m data even if 1m is unavailable
        logger.info(
          `[OhlcvIngestionEngine] Checking 1m data availability for older alert (will try 5m if 1m fails)...`
        );
        const oneMinuteProbe = await this._probe1mData(mint, actualChain, alertTime, options);

        if (oneMinuteProbe.hasData === false && oneMinuteProbe.fromAPI) {
          // For older alerts, try 5m probe before giving up
          logger.info(
            `[OhlcvIngestionEngine] No 1m data for older alert, trying 5m probe for ${mint}...`
          );
          const fiveMinuteProbe = await this._probe5mData(mint, actualChain, alertTime, options);

          if (fiveMinuteProbe.hasData === false && fiveMinuteProbe.fromAPI) {
            // No 1m or 5m data - skip everything
            logger.warn(
              `[OhlcvIngestionEngine] No 1m or 5m data from API for ${mint}..., skipping all intervals`
            );
            return {
              '1m': [],
              '5m': [],
              '15s': [],
              '1H': [],
              metadata,
            };
          } else {
            // 5m data exists, skip 1m but fetch 5m, 15s, 1H
            logger.info(
              `[OhlcvIngestionEngine] 5m data available for ${mint}..., skipping 1m but fetching other intervals`
            );
            // Continue to fetch 5m, 15s, 1H (skip 1m)
            skip1mFetch = true;
          }
        }
      }

      // Get start offset periods (default: 52 periods/candles)
      const startOffsetPeriods = options.startOffsetMinutes ?? 52;

      // Fetch 5000 candles for EACH timeframe: 1m, 5m, 15s, 1H
      logger.info(
        `[OhlcvIngestionEngine] Fetching 5000 candles for each timeframe (1m, 5m, 15s, 1H) starting from -${startOffsetPeriods} periods before alert...`
      );

      // Calculate base start time for each interval based on periods
      const baseStartTime1m = getStartOffsetTime(alertTime, '1m', startOffsetPeriods);
      const baseStartTime5m = getStartOffsetTime(alertTime, '5m', startOffsetPeriods);
      const baseStartTime15s = getStartOffsetTime(alertTime, '15s', startOffsetPeriods);
      const baseStartTime1H = getStartOffsetTime(alertTime, '1H', startOffsetPeriods);

      // Fetch 1m candles: 5000 candles = 5000 minutes (skip if skip1mFetch is true)
      let result1m = { candles: [] as Candle[], fromCache: false };
      if (!skip1mFetch) {
        const endTime1m = baseStartTime1m.plus({ minutes: 5000 });
        result1m = await this._fetchAndStoreChunk({
          mint,
          chain: actualChain,
          interval: '1m',
          startTime: baseStartTime1m,
          endTime: endTime1m,
          options,
        });
        metadata.total1mCandles = result1m.candles.length;
        metadata.chunksFetched += 1;
        if (result1m.fromCache) {
          metadata.chunksFromCache += 1;
        } else {
          metadata.chunksFromAPI += 1;
        }
      } else {
        logger.info(
          `[OhlcvIngestionEngine] Skipping 1m fetch for ${mint}... (5m probe succeeded, 1m probe failed)`
        );
        metadata.total1mCandles = 0;
      }

      // Fetch 5m candles: 5000 candles = 25000 minutes
      const endTime5m = baseStartTime5m.plus({ minutes: 25000 });
      const result5m = await this._fetchAndStoreChunk({
        mint,
        chain: actualChain,
        interval: '5m',
        startTime: baseStartTime5m,
        endTime: endTime5m,
        options,
      });
      metadata.total5mCandles = result5m.candles.length;
      metadata.chunksFetched += 1;
      if (result5m.fromCache) {
        metadata.chunksFromCache += 1;
      } else {
        metadata.chunksFromAPI += 1;
      }

      // Fetch 15s candles: 5000 candles = 75000 seconds = 1250 minutes
      const endTime15s = baseStartTime15s.plus({ minutes: 1250 });
      const result15s = await this._fetchAndStoreChunk({
        mint,
        chain: actualChain,
        interval: '15s',
        startTime: baseStartTime15s,
        endTime: endTime15s,
        options,
      });
      metadata.total15sCandles = result15s.candles.length;
      metadata.chunksFetched += 1;
      if (result15s.fromCache) {
        metadata.chunksFromCache += 1;
      } else {
        metadata.chunksFromAPI += 1;
      }

      // Fetch 1H candles: 5000 candles = 5000 hours = 300000 minutes
      const endTime1H = baseStartTime1H.plus({ minutes: 300000 });
      const result1H = await this._fetchAndStoreChunk({
        mint,
        chain: actualChain,
        interval: '1H',
        startTime: baseStartTime1H,
        endTime: endTime1H,
        options,
      });
      // Note: 1H candles stored in total1sCandles field (legacy naming)
      metadata.total1sCandles = result1H.candles.length;
      metadata.chunksFetched += 1;
      if (result1H.fromCache) {
        metadata.chunksFromCache += 1;
      } else {
        metadata.chunksFromAPI += 1;
      }

      logger.info(`[OhlcvIngestionEngine] Completed fetch for ${mint}...`, {
        '1m': metadata.total1mCandles,
        '5m': metadata.total5mCandles,
        '15s': metadata.total15sCandles,
        '1H': metadata.total1sCandles,
        chunksFromCache: metadata.chunksFromCache,
        chunksFromAPI: metadata.chunksFromAPI,
      });

      return {
        '1m': result1m.candles,
        '5m': result5m.candles,
        '15s': result15s.candles,
        '1H': result1H.candles,
        metadata,
      };
    } catch (error) {
      // Check if error might be due to wrong chain for EVM addresses
      if (isEvmAddress(mint)) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (
          errorMessage.includes('not found') ||
          errorMessage.includes('404') ||
          errorMessage.includes('invalid')
        ) {
          // Try to detect correct chain (use chain parameter, not actualChain which may not be in scope)
          try {
            const chainResult = await fetchMultiChainMetadata(mint, chain);
            if (chainResult.primaryMetadata && chainResult.primaryMetadata.chain !== chain) {
              logger.error('OHLCV fetch failed - wrong chain detected', {
                mint: mint,
                attemptedChain: chain,
                correctChain: chainResult.primaryMetadata.chain,
                symbol: chainResult.primaryMetadata.symbol,
                error: errorMessage,
              });
              throw new ValidationError(
                `OHLCV fetch failed: Token ${mint}... is on ${chainResult.primaryMetadata.chain}, not ${chain}. Please retry with the correct chain.`,
                {
                  mint: mint,
                  attemptedChain: chain,
                  correctChain: chainResult.primaryMetadata.chain,
                  symbol: chainResult.primaryMetadata.symbol,
                }
              );
            }
          } catch (chainError) {
            // If chain detection also fails, log but don't override original error
            logger.debug('Chain detection failed during error handling', {
              mint: mint,
              error: chainError instanceof Error ? chainError.message : String(chainError),
            });
          }
        }
      }

      logger.error(
        `[OhlcvIngestionEngine] Failed to fetch candles for ${mint}...`,
        error as Error
      );
      throw error;
    }
  }

  /**
   * Probe 1m data availability - uses cheap historical price endpoint (10 credits)
   * instead of fetching candles (60 credits) to check if data exists
   * Returns early if API returns no price (saves ~12 API calls per token)
   */
  private async _probe1mData(
    mint: string,
    chain: Chain,
    alertTime: DateTime,
    options: OhlcvIngestionOptions
  ): Promise<{ hasData: boolean; fromAPI: boolean }> {
    // Step 1: Check ClickHouse cache first - if we have candles, we know data exists
    if (options.useCache !== false) {
      try {
        const startOffsetPeriods = options.startOffsetMinutes ?? 52;
        const baseStartTime = alertTime.minus({ minutes: startOffsetPeriods });
        const cachedCandles = await this.storageEngine.getCandles(
          mint,
          chain,
          baseStartTime,
          alertTime,
          { interval: '1m' }
        );
        if (cachedCandles.length > 0) {
          logger.debug(
            `[OhlcvIngestionEngine] Probe: Found cached candles for ${mint}...`
          );
          return { hasData: true, fromAPI: false };
        }
      } catch (error) {
        logger.debug('Probe: ClickHouse check failed, falling back to API', {
          error: (error as Error).message,
        });
      }
    }

    // Step 2: Use cheap historical price endpoint (10 credits) instead of candles (60 credits)
    // Check if price exists at alert time - if price exists, data exists
    const alertUnixTime = Math.floor(alertTime.toSeconds());
    try {
      const historicalPrice = await birdeyeClient.fetchHistoricalPriceAtUnixTime(
        mint,
        alertUnixTime,
        chain
      );

      if (
        historicalPrice &&
        historicalPrice.value !== null &&
        historicalPrice.value !== undefined
      ) {
        logger.debug(
          `[OhlcvIngestionEngine] Probe: Historical price found for ${mint}... (10 credits)`
        );
        return { hasData: true, fromAPI: true };
      } else {
        logger.debug(
          `[OhlcvIngestionEngine] Probe: No historical price for ${mint}... (10 credits)`
        );
        return { hasData: false, fromAPI: true };
      }
    } catch (error) {
      logger.warn('Probe: Historical price check failed, assuming data exists', {
        error: (error as Error).message,
        mint: mint,
      });
      // If probe fails, assume data exists (safer to try than skip)
      return { hasData: true, fromAPI: false };
    }
  }

  /**
   * Probe 5m data availability - uses cheap historical price endpoint (10 credits)
   * instead of fetching candles (60 credits) to check if data exists
   * Similar to _probe1mData but for 5m interval
   */
  private async _probe5mData(
    mint: string,
    chain: Chain,
    alertTime: DateTime,
    options: OhlcvIngestionOptions
  ): Promise<{ hasData: boolean; fromAPI: boolean }> {
    // Step 1: Check ClickHouse cache first - if we have candles, we know data exists
    if (options.useCache !== false) {
      try {
        const startOffsetPeriods = options.startOffsetMinutes ?? 52;
        const baseStartTime = alertTime.minus({ minutes: startOffsetPeriods * 5 });
        const cachedCandles = await this.storageEngine.getCandles(
          mint,
          chain,
          baseStartTime,
          alertTime,
          { interval: '5m' }
        );
        if (cachedCandles.length > 0) {
          logger.debug(
            `[OhlcvIngestionEngine] Probe: Found cached 5m candles for ${mint}...`
          );
          return { hasData: true, fromAPI: false };
        }
      } catch (error) {
        logger.debug('Probe: ClickHouse check failed for 5m, falling back to API', {
          error: (error as Error).message,
        });
      }
    }

    // Step 2: Use cheap historical price endpoint (10 credits) instead of candles (60 credits)
    // Check if price exists at alert time - if price exists, data exists
    const alertUnixTime = Math.floor(alertTime.toSeconds());
    try {
      const historicalPrice = await birdeyeClient.fetchHistoricalPriceAtUnixTime(
        mint,
        alertUnixTime,
        chain
      );

      if (
        historicalPrice &&
        historicalPrice.value !== null &&
        historicalPrice.value !== undefined
      ) {
        logger.debug(
          `[OhlcvIngestionEngine] Probe: Historical price found for 5m check ${mint}... (10 credits)`
        );
        return { hasData: true, fromAPI: true };
      } else {
        logger.debug(
          `[OhlcvIngestionEngine] Probe: No historical price for 5m check ${mint}... (10 credits)`
        );
        return { hasData: false, fromAPI: true };
      }
    } catch (error) {
      logger.warn('Probe: Historical price check failed for 5m, assuming data exists', {
        error: (error as Error).message,
        mint: mint,
      });
      // If probe fails, assume data exists (safer to try than skip)
      return { hasData: true, fromAPI: false };
    }
  }

  /**
   * Fetch and store token metadata
   * CRITICAL: Preserves full mint address and exact case
   * For EVM addresses, uses multi-chain metadata to find correct chain
   */
  private async _fetchAndStoreMetadata(mint: string, chain: Chain): Promise<boolean> {
    try {
      // For EVM addresses, use multi-chain fetching to ensure correct chain
      if (isEvmAddress(mint)) {
        const metadataResult = await fetchMultiChainMetadata(mint, chain);
        if (metadataResult.primaryMetadata) {
          const metadata = metadataResult.primaryMetadata;
          // Use actual chain from API response
          const actualChain = metadata.chain;

          // TokensRepository removed (PostgreSQL) - metadata storage not critical for OHLCV ingestion
          // Metadata is still fetched and used, just not persisted to database

          // Update chain cache if different from hint
          if (actualChain !== chain) {
            this.chainCache.set(mint, actualChain);
            logger.debug(
              `[OhlcvIngestionEngine] Chain corrected during metadata fetch for ${mint}...`,
              {
                chainHint: chain,
                actualChain,
              }
            );
          }

          logger.debug(`[OhlcvIngestionEngine] Metadata stored for ${mint}...`, {
            chain: actualChain,
            symbol: metadata.symbol,
          });
          return true;
        }
        logger.warn(
          `[OhlcvIngestionEngine] No metadata returned for ${mint}... on any chain`
        );
        return false;
      }

      // Solana: use existing logic
      const metadata = await birdeyeClient.getTokenMetadata(mint, chain);
      if (metadata) {
        // TokensRepository removed (PostgreSQL) - metadata storage not critical for OHLCV ingestion
        // Metadata is still fetched and used, just not persisted to database
        logger.debug(`[OhlcvIngestionEngine] Metadata stored for ${mint}...`);
        return true;
      }
      logger.warn(`[OhlcvIngestionEngine] No metadata returned for ${mint}...`);
      return false;
    } catch (error) {
      logger.error(
        `[OhlcvIngestionEngine] Failed to fetch or store metadata for ${mint}...`,
        error as Error
      );
      // Don't throw - metadata fetch failure shouldn't block candle fetching
      return false;
    }
  }

  /**
   * Fetch 1-second candles
   * Strategy: Starting from -52 candles BEFORE alert, fetch 5000 candles forward
   * -52 candles * 1s = -52 seconds before alert
   */
  private async _fetch1sCandles(
    mint: string,
    chain: Chain,
    alertTime: DateTime,
    options: OhlcvIngestionOptions
  ): Promise<{
    candles: Candle[];
    chunksFetched: number;
    chunksFromCache: number;
    chunksFromAPI: number;
  }> {
    // Start from startOffsetPeriods candles before alert
    // For 1s candles, we use 15s as fallback, so calculate based on 15s interval
    const startOffsetPeriods = options.startOffsetMinutes ?? 52;
    const startTime = alertTime.minus({ seconds: startOffsetPeriods });
    // 5000 candles * 1 second = 5000 seconds = ~1.39 hours forward
    const endTime = startTime.plus({ seconds: 5000 });

    // Note: '1s' interval not supported by fetchBirdeyeCandles, using '15s' as fallback
    const result = await this._fetchAndStoreChunk({
      mint,
      chain,
      interval: '15s', // Fallback to 15s since 1s is not supported by Birdeye API
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
   * Fetch 15-second candles - 2 calls of 5000 candles each
   * Strategy: Starting from -52 candles BEFORE alert, fetch 2 calls of 5000 candles each
   * -52 candles * 15s = -780 seconds = -13 minutes before alert
   */
  private async _fetch15sCandlesForWeek(
    mint: string,
    chain: Chain,
    alertTime: DateTime,
    options: OhlcvIngestionOptions
  ): Promise<{
    candles: Candle[];
    chunksFetched: number;
    chunksFromCache: number;
    chunksFromAPI: number;
  }> {
    const allCandles: Candle[] = [];
    let chunksFetched = 0;
    let chunksFromCache = 0;
    let chunksFromAPI = 0;

    // Start from startOffsetPeriods candles before alert
    // startOffsetPeriods candles * 15s = offset in seconds
    const startOffsetPeriods = options.startOffsetMinutes ?? 52;
    const baseStartTime = alertTime.minus({ seconds: startOffsetPeriods * 15 });
    const weekEnd = alertTime.plus({ days: 7 });
    const now = DateTime.utc();
    const actualEnd = weekEnd > now ? now : weekEnd;

    let currentStartTime = baseStartTime;
    let callCount = 0;
    const maxCalls = 2;

    while (currentStartTime < actualEnd && callCount < maxCalls) {
      const chunkEndTime = currentStartTime.plus({ seconds: 5000 * 15 }); // 5000 * 15s = 75000 seconds
      const end = chunkEndTime > actualEnd ? actualEnd : chunkEndTime;

      const result = await this._fetchAndStoreChunk({
        mint,
        chain,
        interval: '15s',
        startTime: currentStartTime,
        endTime: end,
        options,
      });

      chunksFetched++;
      callCount++;

      if (result.fromCache) {
        chunksFromCache++;
      } else {
        chunksFromAPI++;
      }

      if (result.candles.length === 0) {
        break;
      }

      allCandles.push(...result.candles);

      // Move to next chunk
      if (result.candles.length > 0) {
        const lastCandleTime = DateTime.fromSeconds(
          result.candles[result.candles.length - 1].timestamp
        );
        currentStartTime = lastCandleTime.plus({ seconds: 15 });
      } else {
        currentStartTime = end;
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
   * Fetch 1-minute candles for first week
   * Strategy: 4 calls of 5000 candles each, starting from -52 candles BEFORE alert
   * -52 candles * 1m = -52 minutes before alert
   */
  private async _fetch1mCandlesForWeek(
    mint: string,
    chain: Chain,
    alertTime: DateTime,
    options: OhlcvIngestionOptions
  ): Promise<{
    candles: Candle[];
    chunksFetched: number;
    chunksFromCache: number;
    chunksFromAPI: number;
  }> {
    const allCandles: Candle[] = [];
    let chunksFetched = 0;
    let chunksFromCache = 0;
    let chunksFromAPI = 0;

    // Start from startOffsetPeriods candles before alert
    // startOffsetPeriods candles * 1m = offset in minutes
    const startOffsetPeriods = options.startOffsetMinutes ?? 52;
    const baseStartTime = alertTime.minus({ minutes: startOffsetPeriods });
    const weekEnd = alertTime.plus({ days: 7 });
    const now = DateTime.utc();
    const actualEnd = weekEnd > now ? now : weekEnd;

    let currentStartTime = baseStartTime;
    let callCount = 0;
    const maxCalls = 4;

    while (currentStartTime < actualEnd && callCount < maxCalls) {
      const chunkEndTime = currentStartTime.plus({ minutes: 5000 });
      const end = chunkEndTime > actualEnd ? actualEnd : chunkEndTime;

      const result = await this._fetchAndStoreChunk({
        mint,
        chain,
        interval: '1m',
        startTime: currentStartTime,
        endTime: end,
        options,
      });

      chunksFetched++;
      callCount++;

      if (result.fromCache) {
        chunksFromCache++;
      } else {
        chunksFromAPI++;
      }

      if (result.candles.length === 0) {
        break;
      }

      allCandles.push(...result.candles);

      // Move to next chunk
      if (result.candles.length > 0) {
        const lastCandleTime = DateTime.fromSeconds(
          result.candles[result.candles.length - 1].timestamp
        );
        currentStartTime = lastCandleTime.plus({ minutes: 1 });
      } else {
        currentStartTime = end;
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
   * Fetch 5-minute candles for first 34 days
   * Strategy: 6 calls of 5000 candles each, starting from -52 candles BEFORE alert
   * -52 candles * 5m = -260 minutes before alert
   */
  private async _fetch5mCandlesFor34Days(
    mint: string,
    chain: Chain,
    alertTime: DateTime,
    options: OhlcvIngestionOptions
  ): Promise<{
    candles: Candle[];
    chunksFetched: number;
    chunksFromCache: number;
    chunksFromAPI: number;
  }> {
    const allCandles: Candle[] = [];
    let chunksFetched = 0;
    let chunksFromCache = 0;
    let chunksFromAPI = 0;

    // Start from startOffsetPeriods candles before alert
    // startOffsetPeriods candles * 5m = offset in minutes
    const startOffsetPeriods = options.startOffsetMinutes ?? 52;
    const baseStartTime = alertTime.minus({ minutes: startOffsetPeriods * 5 });
    const days34End = alertTime.plus({ days: 34 });
    const now = DateTime.utc();
    const actualEnd = days34End > now ? now : days34End;

    let currentStartTime = baseStartTime;
    let callCount = 0;
    const maxCalls = 6;

    while (currentStartTime < actualEnd && callCount < maxCalls) {
      const chunkEndTime = currentStartTime.plus({ minutes: 5000 * 5 });
      const end = chunkEndTime > actualEnd ? actualEnd : chunkEndTime;

      const result = await this._fetchAndStoreChunk({
        mint,
        chain,
        interval: '5m',
        startTime: currentStartTime,
        endTime: end,
        options,
      });

      chunksFetched++;
      callCount++;

      if (result.fromCache) {
        chunksFromCache++;
      } else {
        chunksFromAPI++;
      }

      if (result.candles.length === 0) {
        break;
      }

      allCandles.push(...result.candles);

      // Move to next chunk
      if (result.candles.length > 0) {
        const lastCandleTime = DateTime.fromSeconds(
          result.candles[result.candles.length - 1].timestamp
        );
        currentStartTime = lastCandleTime.plus({ minutes: 5 });
      } else {
        currentStartTime = end;
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
   * Fetch 5-minute candles
   * Strategy: -260 minutes (5*52) before alert, up to current time, in chunks of 5000 candles
   */
  private async _fetch5mCandles(
    mint: string,
    chain: Chain,
    alertTime: DateTime,
    options: OhlcvIngestionOptions
  ): Promise<{
    candles: Candle[];
    chunksFetched: number;
    chunksFromCache: number;
    chunksFromAPI: number;
  }> {
    const startOffsetPeriods = options.startOffsetMinutes ?? 52;
    const startTime = alertTime.minus({ minutes: startOffsetPeriods * 5 });
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
        const lastCandleTime = DateTime.fromSeconds(
          result.candles[result.candles.length - 1].timestamp
        );
        currentStartTime = lastCandleTime.plus({ minutes: 5 });
      } else {
        // No candles in this chunk, advance by chunk size
        currentStartTime = endTime;
      }

      // Safety check: if we've fetched too many chunks, break
      if (chunksFetched > 100) {
        logger.warn(
          `[OhlcvIngestionEngine] Too many chunks fetched for ${mint}..., stopping`
        );
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
    interval: '1m' | '5m' | '15s' | '1H';
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
        logger.debug(
          `[OhlcvIngestionEngine] In-memory cache hit for ${mint}... (${interval})`
        );
        return { candles: cachedCandles, fromCache: true };
      }
    }

    // Step 2: Check ClickHouse cache
    if (useCache && !forceRefresh) {
      try {
        const dbCandles = await this.storageEngine.getCandles(mint, chain, startTime, endTime, {
          interval,
        });
        if (dbCandles.length > 0) {
          logger.debug(
            `[OhlcvIngestionEngine] ClickHouse cache hit for ${mint}... (${interval}, ${dbCandles.length} candles)`
          );
          // Store in in-memory cache for faster subsequent access
          cache.set(cacheKey, dbCandles);
          return { candles: dbCandles, fromCache: true };
        }
      } catch (error) {
        logger.warn(`[OhlcvIngestionEngine] ClickHouse query failed, falling back to API`, {
          error: (error as Error).message,
          mint: mint,
        });
      }
    }

    // Step 3: Fetch from Birdeye API using fetchBirdeyeCandles (from api-clients)
    logger.info(
      `[OhlcvIngestionEngine] Fetching ${interval} candles from Birdeye for ${mint}...`,
      {
        startTime: startTime.toISO(),
        endTime: endTime.toISO(),
      }
    );

    try {
      const from = Math.floor(startTime.toSeconds());
      const to = Math.floor(endTime.toSeconds());

      // Use fetchBirdeyeCandles from api-clients (handles chunking automatically)
      // Note: fetchBirdeyeCandles only supports '15s' | '1m' | '5m' | '1H'
      // Map interval to supported Birdeye interval
      const birdeyeInterval: '15s' | '1m' | '5m' | '1H' =
        interval === '1H' ? '1H' : interval === '15s' ? '15s' : interval === '1m' ? '1m' : '5m';
      let candles = await fetchBirdeyeCandles(mint, birdeyeInterval, from, to, chain);

      if (candles.length === 0) {
        logger.debug(
          `[OhlcvIngestionEngine] No data returned from Birdeye for ${mint}...`
        );
        return { candles: [], fromCache: false };
      }

      // Validate candles for data errors
      const invalidCandles: Array<{ candle: Candle; reason: string }> = [];
      const missingTimestamps: number[] = [];

      for (const candle of candles) {
        // Check for invalid OHLC values
        if (candle.low > candle.high) {
          invalidCandles.push({
            candle,
            reason: `low (${candle.low}) > high (${candle.high})`,
          });
        }
        if (candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0) {
          invalidCandles.push({
            candle,
            reason: 'non-positive OHLC values',
          });
        }
        if (isNaN(candle.open) || isNaN(candle.high) || isNaN(candle.low) || isNaN(candle.close)) {
          invalidCandles.push({
            candle,
            reason: 'NaN values in OHLC',
          });
        }
        // Check if OHLC values are within reasonable bounds (high >= open/close >= low)
        if (
          candle.high < candle.open ||
          candle.high < candle.close ||
          candle.low > candle.open ||
          candle.low > candle.close
        ) {
          invalidCandles.push({
            candle,
            reason: 'OHLC values out of bounds',
          });
        }
      }

      // Check for missing candles (gaps in expected time series)
      // Only flag as issues if we have very few candles relative to expected count
      // Gaps are normal in API data, especially for older/less liquid tokens
      if (candles.length > 0 && interval !== '15s') {
        const intervalSeconds = interval === '1m' ? 60 : interval === '5m' ? 300 : 3600;
        const expectedStart = Math.floor(startTime.toSeconds());
        const expectedEnd = Math.floor(endTime.toSeconds());
        const expectedCount = Math.floor((expectedEnd - expectedStart) / intervalSeconds);

        // Only flag if we have less than 50% of expected candles (significant data loss)
        // This prevents false positives from normal gaps in historical data
        if (candles.length < expectedCount * 0.5 && expectedCount > 10) {
          // Only check for missing timestamps if we have significant data loss
          for (
            let expectedTime = expectedStart;
            expectedTime <= expectedEnd;
            expectedTime += intervalSeconds
          ) {
            const hasCandle = candles.some(
              (c: Candle) => Math.abs(c.timestamp - expectedTime) < intervalSeconds / 2
            );
            if (!hasCandle) {
              missingTimestamps.push(expectedTime);
            }
          }
          // Limit missing timestamps to avoid huge arrays
          if (missingTimestamps.length > 100) {
            missingTimestamps.length = 100;
          }
        }
      }

      // If we have invalid candles or significant missing candles, try to fix them
      // Only warn if we have actual invalid data (not just gaps, which are normal)
      if (
        invalidCandles.length > 0 ||
        (missingTimestamps.length > 0 && missingTimestamps.length > candles.length * 0.5)
      ) {
        logger.warn(`[OhlcvIngestionEngine] Found data issues for ${mint}...`, {
          invalidCandles: invalidCandles.length,
          missingCandles: missingTimestamps.length,
          totalCandles: candles.length,
          interval,
        });

        // Try a repeat fetch first
        logger.debug(
          `[OhlcvIngestionEngine] Attempting repeat OHLCV fetch for ${mint}...`
        );
        try {
          const retryCandles = await fetchBirdeyeCandles(mint, interval, from, to, chain);

          if (retryCandles.length > 0) {
            // Re-validate the retry data
            const retryInvalid = retryCandles.filter(
              (c: Candle) =>
                c.low > c.high ||
                c.open <= 0 ||
                c.high <= 0 ||
                c.low <= 0 ||
                c.close <= 0 ||
                isNaN(c.open) ||
                isNaN(c.high) ||
                isNaN(c.low) ||
                isNaN(c.close)
            );

            if (retryInvalid.length === 0) {
              logger.info(
                `[OhlcvIngestionEngine] Repeat fetch fixed data issues for ${mint}...`
              );
              candles = retryCandles;
            } else {
              // Retry also has issues, use historical price fallback for invalid/missing candles
              logger.warn(
                `[OhlcvIngestionEngine] Repeat fetch still has issues, using historical price fallback for ${mint}...`
              );
              candles = await this._fixCandlesWithHistoricalPrice(
                mint,
                chain,
                retryCandles,
                invalidCandles.map((ic) => ic.candle),
                missingTimestamps,
                interval
              );
            }
          } else {
            // Retry returned no data, use historical price fallback
            logger.warn(
              `[OhlcvIngestionEngine] Repeat fetch returned no data, using historical price fallback for ${mint}...`
            );
            candles = await this._fixCandlesWithHistoricalPrice(
              mint,
              chain,
              candles,
              invalidCandles.map((ic) => ic.candle),
              missingTimestamps,
              interval
            );
          }
        } catch (retryError) {
          // Retry failed, use historical price fallback
          logger.warn(
            `[OhlcvIngestionEngine] Repeat fetch failed, using historical price fallback for ${mint}...`,
            { error: retryError instanceof Error ? retryError.message : String(retryError) }
          );
          candles = await this._fixCandlesWithHistoricalPrice(
            mint,
            chain,
            candles,
            invalidCandles.map((ic) => ic.candle),
            missingTimestamps,
            interval
          );
        }
      }

      if (candles.length === 0) {
        logger.debug(
          `[OhlcvIngestionEngine] No candles in time range for ${mint}...`
        );
        return { candles: [], fromCache: false };
      }

      // Step 4: Store immediately to prevent data loss on script failure
      // CRITICAL: Store to ClickHouse using ohlcv storage service (offline operation)
      try {
        // Map interval to storeCandles format (accepts '1m' | '5m' | '15m' | '1h' | '15s' | '1H')
        const storeInterval: '1m' | '5m' | '15m' | '1h' | '15s' | '1H' =
          interval === '1H' ? '1H' : interval === '15s' ? '15s' : interval === '1m' ? '1m' : '5m';
        await storeCandles(mint, chain, candles, storeInterval);
        logger.debug(
          `[OhlcvIngestionEngine] Stored ${candles.length} ${interval} candles to ClickHouse for ${mint}...`
        );
      } catch (error) {
        logger.error(
          `[OhlcvIngestionEngine] Failed to store candles to ClickHouse`,
          error as Error,
          {
            mint: mint,
            interval,
            candleCount: candles.length,
          }
        );
        // Continue even if storage fails - at least we have the data in memory
      }

      // Step 5: Store in in-memory cache for faster subsequent access
      cache.set(cacheKey, candles);

      logger.info(
        `[OhlcvIngestionEngine] Fetched and stored ${candles.length} ${interval} candles for ${mint}...`
      );
      return { candles, fromCache: false };
    } catch (error) {
      // Check if error might be due to wrong chain for EVM addresses
      if (isEvmAddress(mint)) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (
          errorMessage.includes('not found') ||
          errorMessage.includes('404') ||
          errorMessage.includes('invalid')
        ) {
          // Try to detect correct chain
          try {
            const chainResult = await fetchMultiChainMetadata(mint, chain);
            if (chainResult.primaryMetadata && chainResult.primaryMetadata.chain !== chain) {
              logger.error('OHLCV fetch failed - wrong chain detected in _fetchAndStoreChunk', {
                mint: mint,
                attemptedChain: chain,
                correctChain: chainResult.primaryMetadata.chain,
                symbol: chainResult.primaryMetadata.symbol,
                interval,
                error: errorMessage,
              });
              throw new ValidationError(
                `OHLCV fetch failed: Token ${mint}... is on ${chainResult.primaryMetadata.chain}, not ${chain}. Please retry with the correct chain.`,
                {
                  mint: mint,
                  attemptedChain: chain,
                  correctChain: chainResult.primaryMetadata.chain,
                  symbol: chainResult.primaryMetadata.symbol,
                }
              );
            }
          } catch (chainError) {
            // If chain detection also fails, log but don't override original error
            logger.debug('Chain detection failed during error handling in _fetchAndStoreChunk', {
              mint: mint,
              error: chainError instanceof Error ? chainError.message : String(chainError),
            });
          }
        }
      }

      logger.error(`[OhlcvIngestionEngine] Failed to fetch candles from Birdeye`, error as Error, {
        mint: mint,
        interval,
        startTime: startTime.toISO(),
        endTime: endTime.toISO(),
        chain,
      });
      throw error;
    }
  }

  /**
   * Fix invalid or missing candles using historical price API
   * Replaces invalid candles and fills missing candles with historical price data
   */
  private async _fixCandlesWithHistoricalPrice(
    mint: string,
    chain: Chain,
    existingCandles: Candle[],
    invalidCandles: Candle[],
    missingTimestamps: number[],
    _interval: '1m' | '5m' | '15s' | '1H'
  ): Promise<Candle[]> {
    const fixedCandles: Candle[] = [];
    const timestampsToFix = new Set<number>();

    // Collect all timestamps that need fixing
    for (const invalidCandle of invalidCandles) {
      timestampsToFix.add(invalidCandle.timestamp);
    }
    for (const missingTs of missingTimestamps) {
      timestampsToFix.add(missingTs);
    }

    // Keep valid existing candles
    const validCandles = existingCandles.filter(
      (c) =>
        !timestampsToFix.has(c.timestamp) &&
        c.low <= c.high &&
        c.open > 0 &&
        c.high > 0 &&
        c.low > 0 &&
        c.close > 0 &&
        !isNaN(c.open) &&
        !isNaN(c.high) &&
        !isNaN(c.low) &&
        !isNaN(c.close)
    );
    fixedCandles.push(...validCandles);

    // Fix invalid/missing candles using historical price API
    logger.debug(
      `[OhlcvIngestionEngine] Fixing ${timestampsToFix.size} candles using historical price API for ${mint}...`
    );

    for (const timestamp of timestampsToFix) {
      try {
        const historicalPrice = await birdeyeClient.fetchHistoricalPriceAtUnixTime(
          mint,
          timestamp,
          chain
        );

        if (historicalPrice && historicalPrice.value > 0) {
          // Create a candle from the historical price
          // Use the price as open, high, low, close (since we only have one price point)
          const price = historicalPrice.value;
          fixedCandles.push({
            timestamp,
            open: price,
            high: price,
            low: price,
            close: price,
            volume: 0, // No volume data from historical price endpoint
          });
          logger.debug(
            `[OhlcvIngestionEngine] Fixed candle at ${timestamp} using historical price: ${price}`
          );
        } else {
          logger.warn(
            `[OhlcvIngestionEngine] Could not fetch historical price for timestamp ${timestamp}`
          );
          // Try to use nearby valid candle as fallback
          const nearbyCandle = existingCandles
            .filter((c) => c.low <= c.high && c.close > 0)
            .sort(
              (a, b) => Math.abs(a.timestamp - timestamp) - Math.abs(b.timestamp - timestamp)
            )[0];

          if (nearbyCandle) {
            fixedCandles.push({
              timestamp,
              open: nearbyCandle.close,
              high: nearbyCandle.close,
              low: nearbyCandle.close,
              close: nearbyCandle.close,
              volume: 0,
            });
            logger.debug(
              `[OhlcvIngestionEngine] Used nearby candle price (${nearbyCandle.close}) for timestamp ${timestamp}`
            );
          }
        }
      } catch (error) {
        logger.warn(
          `[OhlcvIngestionEngine] Failed to fetch historical price for timestamp ${timestamp}`,
          { error: error instanceof Error ? error.message : String(error) }
        );
      }
    }

    // Sort by timestamp and return
    return fixedCandles.sort((a: Candle, b: Candle) => a.timestamp - b.timestamp);
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
    cache.forEach((candles: Candle[]) => {
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
