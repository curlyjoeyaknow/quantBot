/**
 * OHLCV Data Management Service (Offline-Only)
 *
 * Centralized service for querying and caching OHLCV candles.
 * Provides multi-layer caching (in-memory → ClickHouse via StorageEngine).
 *
 * NOTE: This service is OFFLINE-ONLY. It does NOT fetch candles from APIs.
 * For fetching candles, use @quantbot/api-clients in @quantbot/ingestion workflows,
 * then store them using the storeCandles() function from ohlcv-storage.
 */

import { DateTime } from 'luxon';
import { getStorageEngine, initClickHouse } from '@quantbot/storage';
import type { Candle } from '@quantbot/core';
import { logger } from '@quantbot/utils';
import { storeCandles as storeCandlesOffline } from './ohlcv-storage';

export interface OHLCVFetchOptions {
  interval?: '1m' | '5m' | '1H';
  useCache?: boolean;
  forceRefresh?: boolean;
}

export interface OHLCVIngestOptions {
  interval?: '1m' | '5m' | '1H';
  skipDuplicates?: boolean;
}

export interface OHLCVGetOptions extends OHLCVFetchOptions {
  alertTime?: DateTime;
}

/**
 * OHLCV Service for managing candle data (offline-only)
 *
 * This service only queries ClickHouse and cache. It does NOT fetch from APIs.
 */
export class OHLCVService {
  private storageEngine = getStorageEngine();
  private inMemoryCache: Map<string, { candles: Candle[]; timestamp: number }> = new Map();
  private readonly cacheTTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Initialize the service (ensure ClickHouse is ready)
   */
  async initialize(): Promise<void> {
    try {
      await initClickHouse();
      logger.info('OHLCV Service initialized');
    } catch (error) {
      logger.error('Failed to initialize OHLCV Service', error as Error);
      throw error;
    }
  }

  /**
   * Store candles (offline operation)
   *
   * Stores candles that have already been fetched. For fetching, use
   * @quantbot/api-clients in @quantbot/ingestion workflows.
   */
  async storeCandles(
    mint: string,
    chain: string,
    candles: Candle[],
    interval: '1m' | '5m' | '1H' = '5m'
  ): Promise<void> {
    await storeCandlesOffline(mint, chain, candles, interval);
  }

  /**
   * Ingest candles into ClickHouse
   */
  async ingestCandles(
    mint: string,
    chain: string,
    candles: Candle[],
    options: OHLCVIngestOptions = {}
  ): Promise<{ ingested: number; skipped: number }> {
    const { interval = '5m', skipDuplicates = true } = options;

    if (candles.length === 0) {
      return { ingested: 0, skipped: 0 };
    }

    try {
      // Check for existing data if skipDuplicates is enabled
      if (skipDuplicates && candles.length > 0) {
        const firstCandle = DateTime.fromSeconds(candles[0].timestamp);
        const lastCandle = DateTime.fromSeconds(candles[candles.length - 1].timestamp);
        const existing = await this.storageEngine.getCandles(mint, chain, firstCandle, lastCandle, {
          interval,
        });

        if (existing.length > 0) {
          logger.debug('Candles already exist in ClickHouse, skipping', {
            mint: mint.substring(0, 20),
            count: candles.length,
          });
          return { ingested: 0, skipped: candles.length };
        }
      }

      await this.storageEngine.storeCandles(mint, chain, candles, interval);

      logger.info('Ingested candles into ClickHouse', {
        mint: mint.substring(0, 20),
        count: candles.length,
        interval,
      });

      return { ingested: candles.length, skipped: 0 };
    } catch (error: unknown) {
      logger.error('Failed to ingest candles', error as Error, {
        mint: mint.substring(0, 20),
      });
      throw error;
    }
  }

  /**
   * Get candles with multi-layer caching
   * Priority: in-memory → ClickHouse → Birdeye API
   */
  async getCandles(
    mint: string,
    chain: string,
    startTime: DateTime,
    endTime: DateTime,
    options: OHLCVGetOptions = {}
  ): Promise<Candle[]> {
    const { interval = '5m', useCache = true, forceRefresh = false, alertTime } = options;

    // Check in-memory cache first
    if (useCache && !forceRefresh) {
      const cacheKey = this.getCacheKey(mint, chain, startTime, endTime, interval);
      const cached = this.inMemoryCache.get(cacheKey);

      if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
        logger.debug('Using in-memory cache', { mint: mint.substring(0, 20) });
        return cached.candles;
      }
    }

    // Try ClickHouse
    if (useCache && !forceRefresh) {
      try {
        const clickhouseCandles = await this.storageEngine.getCandles(
          mint,
          chain,
          startTime,
          endTime,
          { interval }
        );
        if (clickhouseCandles.length > 0) {
          logger.debug('Using ClickHouse cache', {
            mint: mint.substring(0, 20),
            count: clickhouseCandles.length,
          });

          // Store in in-memory cache
          const cacheKey = this.getCacheKey(mint, chain, startTime, endTime, interval);
          this.inMemoryCache.set(cacheKey, {
            candles: clickhouseCandles,
            timestamp: Date.now(),
          });

          return clickhouseCandles;
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn('ClickHouse query failed, falling back to API', {
          error: errorMessage,
          mint: mint.substring(0, 20),
        });
      }
    }

    // Offline-only: Return empty if not in cache
    // Candles must be fetched via @quantbot/api-clients and stored via storeCandles()
    logger.debug('No candles found in cache (offline-only mode)', {
      mint: mint.substring(0, 20),
      chain,
      interval,
    });
    return [];
  }

  /**
   * Store candles (offline operation)
   *
   * This method stores candles that have already been fetched.
   * For fetching, use @quantbot/api-clients in @quantbot/ingestion workflows.
   */
  async storeCandlesWithOptions(
    mint: string,
    chain: string,
    candles: Candle[],
    options: OHLCVIngestOptions = {}
  ): Promise<{ ingested: number; skipped: number }> {
    return this.ingestCandles(mint, chain, candles, options);
  }

  /**
   * Clear in-memory cache
   */
  clearCache(): void {
    this.inMemoryCache.clear();
    logger.debug('In-memory cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    inMemoryEntries: number;
    cacheSize: number;
  } {
    let totalSize = 0;
    this.inMemoryCache.forEach((entry) => {
      totalSize += entry.candles.length;
    });

    return {
      inMemoryEntries: this.inMemoryCache.size,
      cacheSize: totalSize,
    };
  }

  /**
   * Generate cache key
   */
  private getCacheKey(
    mint: string,
    chain: string,
    startTime: DateTime,
    endTime: DateTime,
    interval: string
  ): string {
    return `${chain}:${mint}:${startTime.toISO()}:${endTime.toISO()}:${interval}`;
  }
}

// Export singleton instance
export const ohlcvService = new OHLCVService();
