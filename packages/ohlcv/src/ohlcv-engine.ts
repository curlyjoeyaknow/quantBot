/**
 * Unified OHLCV Engine
 * 
 * Single source of truth for all OHLCV operations:
 * - Fetching (from API, cache, or ClickHouse)
 * - Ingestion (to ClickHouse and CSV cache)
 * - Caching (ClickHouse and CSV)
 * 
 * This eliminates ad-hoc scripts and ensures consistent behavior across the codebase.
 */

import { DateTime } from 'luxon';
import { fetchHybridCandles } from '@quantbot/data';
import type { Candle } from '@quantbot/core';
import { logger } from '@quantbot/utils';
import { insertCandles, queryCandles, initClickHouse } from '@quantbot/data';

export interface OHLCVFetchOptions {
  /**
   * If true, only use cache (no API calls)
   */
  cacheOnly?: boolean;
  
  /**
   * If true, ensure candles are ingested to ClickHouse after fetching
   */
  ensureIngestion?: boolean;
  
  /**
   * Optional alert time - if provided, fetches 1m candles for 30min before/after
   */
  alertTime?: DateTime;
  
  /**
   * Interval to use for ingestion (defaults to '5m')
   */
  interval?: '1m' | '5m' | '1H';
}

export interface OHLCVFetchResult {
  candles: Candle[];
  fromCache: boolean;
  ingestedToClickHouse: boolean;
  source: 'clickhouse' | 'csv' | 'api';
}

export class OHLCVEngine {
  private clickHouseEnabled: boolean;

  constructor() {
    this.clickHouseEnabled = process.env.USE_CLICKHOUSE === 'true' || !!process.env.CLICKHOUSE_HOST;
  }

  /**
   * Initialize the engine (e.g., connect to ClickHouse)
   */
  async initialize(): Promise<void> {
    if (this.clickHouseEnabled) {
      try {
        await initClickHouse();
        logger.info('OHLCV Engine: ClickHouse initialized');
      } catch (error: any) {
        logger.warn('OHLCV Engine: ClickHouse initialization failed', { error: error.message });
        this.clickHouseEnabled = false;
      }
    }
  }

  /**
   * Fetch OHLCV candles with automatic caching and ingestion
   * 
   * This is the main entry point - it handles:
   * 1. Checking ClickHouse cache
   * 2. Checking CSV cache
   * 3. Fetching from API if needed
   * 4. Ingesting to ClickHouse
   * 5. Caching to CSV
   * 
   * @param tokenAddress Token mint address
   * @param startTime Start time for candles
   * @param endTime End time for candles
   * @param chain Blockchain name (defaults to 'solana')
   * @param options Fetch options
   * @returns Fetch result with candles and metadata
   */
  async fetch(
    tokenAddress: string,
    startTime: DateTime,
    endTime: DateTime,
    chain: string = 'solana',
    options: OHLCVFetchOptions = {}
  ): Promise<OHLCVFetchResult> {
    const {
      cacheOnly = false,
      ensureIngestion = true,
      alertTime,
      interval = '5m'
    } = options;

    // Step 1: Check ClickHouse cache first (if enabled)
    if (this.clickHouseEnabled) {
      try {
        const cachedCandles = await queryCandles(tokenAddress, chain, startTime, endTime);
        if (cachedCandles.length > 0) {
          logger.debug(`OHLCV Engine: Using ClickHouse cache for ${tokenAddress.substring(0, 20)}... (${cachedCandles.length} candles)`);
          return {
            candles: cachedCandles,
            fromCache: true,
            ingestedToClickHouse: true,
            source: 'clickhouse'
          };
        }
      } catch (error: any) {
        logger.warn('OHLCV Engine: ClickHouse query failed', { error: error.message, tokenAddress: tokenAddress.substring(0, 20) });
      }
    }

    // Step 2: If cache-only mode, return empty (no API calls)
    if (cacheOnly) {
      logger.debug(`OHLCV Engine: Cache-only mode, no candles found for ${tokenAddress.substring(0, 20)}...`);
      return {
        candles: [],
        fromCache: false,
        ingestedToClickHouse: false,
        source: 'api'
      };
    }

    // Step 3: Fetch from API (fetchHybridCandles handles CSV cache internally)
    // Temporarily set USE_CACHE_ONLY to preserve existing cache behavior
    const originalCacheOnly = process.env.USE_CACHE_ONLY;
    if (cacheOnly) {
      process.env.USE_CACHE_ONLY = 'true';
    }

    try {
      const candles = await fetchHybridCandles(
        tokenAddress,
        startTime,
        endTime,
        chain,
        alertTime
      );

      // Restore original setting
      if (originalCacheOnly !== undefined) {
        process.env.USE_CACHE_ONLY = originalCacheOnly;
      } else {
        delete process.env.USE_CACHE_ONLY;
      }

      if (candles.length === 0) {
        return {
          candles: [],
          fromCache: false,
          ingestedToClickHouse: false,
          source: 'api'
        };
      }

      // Step 4: Determine if we got candles from cache (CSV) or API
      // fetchHybridCandles returns from cache if available, so we check ClickHouse again
      // to see if these candles are already there
      let fromCache = false;
      let ingestedToClickHouse = false;

      if (this.clickHouseEnabled) {
        try {
          const existingCandles = await queryCandles(tokenAddress, chain, startTime, endTime);
          if (existingCandles.length >= candles.length * 0.9) {
            // If ClickHouse has most of the candles, they were likely from cache
            fromCache = true;
            ingestedToClickHouse = true;
          }
        } catch (error) {
          // Ignore - we'll ingest below
        }
      }

      // Step 5: Ensure ingestion to ClickHouse if requested
      if (ensureIngestion && this.clickHouseEnabled && !ingestedToClickHouse) {
        try {
          // Determine intervals to ingest
          if (alertTime && candles.length > 1) {
            // Separate 5m and 1m candles based on timestamp differences
            const alertWindowStart = alertTime.minus({ minutes: 30 });
            const alertWindowEnd = alertTime.plus({ minutes: 30 });
            
            const candles5m: Candle[] = [];
            const candles1m: Candle[] = [];
            
            // Detect interval by checking time difference between consecutive candles
            const timeDiff = candles[1].timestamp - candles[0].timestamp;
            const is1mInterval = timeDiff <= 90; // 1m candles have ~60s difference, 5m have ~300s
            
            for (const candle of candles) {
              const candleTime = DateTime.fromSeconds(candle.timestamp);
              if (candleTime >= alertWindowStart && candleTime <= alertWindowEnd && is1mInterval) {
                candles1m.push(candle);
              } else {
                candles5m.push(candle);
              }
            }
            
            // Ingest 5m candles
            if (candles5m.length > 0) {
              await insertCandles(tokenAddress, chain, candles5m, '5m');
            }
            
            // Ingest 1m candles
            if (candles1m.length > 0) {
              await insertCandles(tokenAddress, chain, candles1m, '1m');
            }
          } else {
            // Ingest all as single interval
            await insertCandles(tokenAddress, chain, candles, interval);
          }
          
          ingestedToClickHouse = true;
          logger.debug(`OHLCV Engine: Ingested ${candles.length} candles to ClickHouse for ${tokenAddress.substring(0, 20)}...`);
        } catch (error: any) {
          logger.warn(`OHLCV Engine: Failed to ingest to ClickHouse for ${tokenAddress.substring(0, 20)}...`, { error: error.message });
        }
      }

      return {
        candles,
        fromCache,
        ingestedToClickHouse,
        source: fromCache ? 'csv' : 'api'
      };
    } catch (error: any) {
      // Restore original setting on error
      if (originalCacheOnly !== undefined) {
        process.env.USE_CACHE_ONLY = originalCacheOnly;
      } else {
        delete process.env.USE_CACHE_ONLY;
      }
      throw error;
    }
  }

  /**
   * Batch fetch candles for multiple tokens
   * 
   * @param tokens Array of token addresses
   * @param startTime Start time for candles
   * @param endTime End time for candles
   * @param chain Blockchain name
   * @param options Fetch options
   * @returns Map of token address to fetch result
   */
  async batchFetch(
    tokens: string[],
    startTime: DateTime,
    endTime: DateTime,
    chain: string = 'solana',
    options: OHLCVFetchOptions = {}
  ): Promise<Map<string, OHLCVFetchResult>> {
    const results = new Map<string, OHLCVFetchResult>();
    
    logger.info(`OHLCV Engine: Batch fetching ${tokens.length} tokens`);
    
    for (const token of tokens) {
      try {
        const result = await this.fetch(token, startTime, endTime, chain, options);
        results.set(token, result);
      } catch (error: any) {
        logger.error(`OHLCV Engine: Failed to fetch ${token.substring(0, 20)}...`, error as Error);
        results.set(token, {
          candles: [],
          fromCache: false,
          ingestedToClickHouse: false,
          source: 'api'
        });
      }
    }
    
    return results;
  }

  /**
   * Get statistics about cached vs fetched candles
   */
  getStats(results: Map<string, OHLCVFetchResult>): {
    total: number;
    fromCache: number;
    fromAPI: number;
    ingested: number;
    totalCandles: number;
  } {
    let fromCache = 0;
    let fromAPI = 0;
    let ingested = 0;
    let totalCandles = 0;

    for (const result of results.values()) {
      if (result.candles.length > 0) {
        if (result.fromCache) {
          fromCache++;
        } else {
          fromAPI++;
        }
        if (result.ingestedToClickHouse) {
          ingested++;
        }
        totalCandles += result.candles.length;
      }
    }

    return {
      total: results.size,
      fromCache,
      fromAPI,
      ingested,
      totalCandles
    };
  }
}

// Singleton instance
let engineInstance: OHLCVEngine | null = null;

/**
 * Get the singleton OHLCV Engine instance
 */
export function getOHLCVEngine(): OHLCVEngine {
  if (!engineInstance) {
    engineInstance = new OHLCVEngine();
  }
  return engineInstance;
}

