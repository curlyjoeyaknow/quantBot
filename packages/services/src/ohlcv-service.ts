/**
 * OHLCV Data Management Service
 * 
 * Centralized service for fetching, ingesting, and caching OHLCV candles.
 * Provides multi-layer caching (in-memory → ClickHouse → CSV cache) and
 * integrates with Birdeye API and ClickHouse storage.
 */

import { DateTime } from 'luxon';
import { insertCandles, queryCandles, hasCandles, initClickHouse } from '@quantbot/storage';
import { fetchHybridCandles, type Candle } from '@quantbot/simulation';
import { logger } from '@quantbot/utils';

import { birdeyeClient } from './api/birdeye-client';

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
 * OHLCV Service for managing candle data
 */
export class OHLCVService {
  private readonly birdeyeClient = birdeyeClient;
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
   * Fetch candles from Birdeye API
   */
  async fetchCandles(
    mint: string,
    chain: string,
    startTime: DateTime,
    endTime: DateTime,
    interval: '1m' | '5m' | '1H' = '5m'
  ): Promise<Candle[]> {
    try {
      logger.debug('Fetching candles from Birdeye', {
        mint: mint.substring(0, 20),
        chain,
        startTime: startTime.toISO(),
        endTime: endTime.toISO(),
        interval,
      });

      const startUnix = Math.floor(startTime.toSeconds());
      const endUnix = Math.floor(endTime.toSeconds());

      // Use Birdeye client to fetch OHLCV data
      const birdeyeData = await this.birdeyeClient.fetchOHLCVData(
        mint,
        new Date(startUnix * 1000),
        new Date(endUnix * 1000),
        interval
      );

      if (!birdeyeData || !birdeyeData.items || birdeyeData.items.length === 0) {
        logger.warn('No data returned from Birdeye API', { mint: mint.substring(0, 20) });
        return [];
      }

      // Convert Birdeye format to Candle format
      const candles: Candle[] = birdeyeData.items
        .map((item: any) => ({
          timestamp: item.unixTime,
          open: parseFloat(item.open) || 0,
          high: parseFloat(item.high) || 0,
          low: parseFloat(item.low) || 0,
          close: parseFloat(item.close) || 0,
          volume: parseFloat(item.volume) || 0,
        }))
        .filter((c: any) => c.timestamp >= startUnix && c.timestamp <= endUnix)
        .sort((a: any, b: any) => a.timestamp - b.timestamp);

      logger.debug('Fetched candles from Birdeye', {
        mint: mint.substring(0, 20),
        count: candles.length,
      });

      return candles;
    } catch (error: any) {
      logger.error('Failed to fetch candles from Birdeye', error as Error, {
        mint: mint.substring(0, 20),
      });
      throw error;
    }
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
        const existing = await hasCandles(mint, chain, firstCandle, lastCandle);

        if (existing) {
          logger.debug('Candles already exist in ClickHouse, skipping', {
            mint: mint.substring(0, 20),
            count: candles.length,
          });
          return { ingested: 0, skipped: candles.length };
        }
      }

      await insertCandles(mint, chain, candles, interval);

      logger.info('Ingested candles into ClickHouse', {
        mint: mint.substring(0, 20),
        count: candles.length,
        interval,
      });

      return { ingested: candles.length, skipped: 0 };
    } catch (error: any) {
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
    const {
      interval = '5m',
      useCache = true,
      forceRefresh = false,
      alertTime,
    } = options;

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
        const clickhouseCandles = await queryCandles(mint, chain, startTime, endTime, interval);
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
      } catch (error: any) {
        logger.warn('ClickHouse query failed, falling back to API', {
          error: error.message,
          mint: mint.substring(0, 20),
        });
      }
    }

    // Fall back to fetchHybridCandles (which uses CSV cache and Birdeye API)
    try {
      const candles = await fetchHybridCandles(
        mint,
        startTime,
        endTime,
        chain,
        alertTime
      );

      // Ingest into ClickHouse for future use
      if (candles.length > 0 && useCache) {
        try {
          await this.ingestCandles(mint, chain, candles, { interval, skipDuplicates: true });
        } catch (error: any) {
          logger.warn('Failed to ingest candles to ClickHouse', {
            error: error.message,
            mint: mint.substring(0, 20),
          });
        }
      }

      // Store in in-memory cache
      if (candles.length > 0) {
        const cacheKey = this.getCacheKey(mint, chain, startTime, endTime, interval);
        this.inMemoryCache.set(cacheKey, {
          candles,
          timestamp: Date.now(),
        });
      }

      return candles;
    } catch (error: any) {
      logger.error('Failed to get candles', error as Error, {
        mint: mint.substring(0, 20),
      });
      throw error;
    }
  }

  /**
   * Fetch and ingest candles in one operation
   */
  async fetchAndIngest(
    mint: string,
    chain: string,
    startTime: DateTime,
    endTime: DateTime,
    options: OHLCVFetchOptions & OHLCVIngestOptions = {}
  ): Promise<{ fetched: number; ingested: number; skipped: number }> {
    const candles = await this.fetchCandles(mint, chain, startTime, endTime, options.interval);
    const result = await this.ingestCandles(mint, chain, candles, options);

    return {
      fetched: candles.length,
      ingested: result.ingested,
      skipped: result.skipped,
    };
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

