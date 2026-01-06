/**
 * Unified OHLCV Engine (Offline-Only)
 *
 * Single source of truth for all OHLCV query operations:
 * - Querying from ClickHouse/cache
 * - Storing candles (offline operation)
 *
 * NOTE: This engine is OFFLINE-ONLY. It does NOT fetch candles from APIs.
 * For fetching candles, use @quantbot/api-clients in @quantbot/jobs workflows,
 * then store them using the storeCandles() method.
 *
 * This eliminates ad-hoc scripts and ensures consistent behavior across the codebase.
 */

import { DateTime } from 'luxon';
import type { Candle, Chain } from '@quantbot/core';
import { normalizeChain } from '@quantbot/core';
import { logger } from '@quantbot/infra/utils';
import { getStorageEngine, initClickHouse } from '@quantbot/infra/storage';
import { storeCandles as storeCandlesOffline } from './ohlcv-storage.js';

export interface OHLCVEngineFetchOptions {
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
  private storageEngine = getStorageEngine();

  /**
   * Initialize the engine (e.g., connect to ClickHouse)
   * NOTE: ClickHouse initialization is handled by the storage engine.
   * This method is kept for backward compatibility but may be a no-op.
   */
  async initialize(): Promise<void> {
    try {
      await initClickHouse();
      logger.info('OHLCV Engine: ClickHouse initialized');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn('OHLCV Engine: ClickHouse initialization failed', { error: errorMessage });
      // Continue anyway - queries will fail gracefully if ClickHouse is unavailable
    }
  }

  /**
   * Query OHLCV candles from ClickHouse/cache (offline operation)
   *
   * This is the main entry point for querying candles. It only queries
   * ClickHouse and cache - it does NOT fetch from APIs.
   *
   * @param tokenAddress Token mint address
   * @param startTime Start time for candles
   * @param endTime End time for candles
   * @param chain Blockchain name (defaults to 'solana')
   * @param options Query options
   * @returns Query result with candles and metadata
   */
  async query(
    tokenAddress: string,
    startTime: DateTime,
    endTime: DateTime,
    chain: string = 'solana',
    options: OHLCVEngineFetchOptions = {}
  ): Promise<OHLCVFetchResult> {
    const { interval = '5m' } = options;

    // Normalize chain to lowercase
    const normalizedChain = normalizeChain(chain);

    // Query ClickHouse (storage engine handles availability)
    try {
      const candles = await this.storageEngine.getCandles(
        tokenAddress,
        normalizedChain,
        startTime,
        endTime,
        {
          interval,
        }
      );
      if (candles.length > 0) {
        logger.debug(
          `OHLCV Engine: Found ${candles.length} candles in ClickHouse for ${tokenAddress}...`
        );
        return {
          candles,
          fromCache: true,
          ingestedToClickHouse: true,
          source: 'clickhouse',
        };
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn('OHLCV Engine: ClickHouse query failed', {
        error: errorMessage,
        tokenAddress: tokenAddress,
      });
      // Continue to return empty result (offline-only mode)
    }

    // No candles found (offline-only mode - no API calls)
    logger.debug(`OHLCV Engine: No candles found for ${tokenAddress}... (offline-only mode)`);
    return {
      candles: [],
      fromCache: false,
      ingestedToClickHouse: false,
      source: 'clickhouse',
    };
  }

  /**
   * Store candles (offline operation)
   *
   * Stores candles that have already been fetched. For fetching, use
   * @quantbot/api-clients in @quantbot/jobs workflows.
   *
   * @param tokenAddress Token mint address
   * @param chain Blockchain name
   * @param candles Array of candles to store
   * @param interval Candle interval
   */
  async storeCandles(
    tokenAddress: string,
    chain: Chain,
    candles: Candle[],
    interval: '1m' | '5m' | '1H' = '5m'
  ): Promise<void> {
    await storeCandlesOffline(tokenAddress, chain, candles, interval);
  }

  /**
   * @deprecated Use query() instead. This method is kept for backward compatibility.
   */
  async fetch(
    tokenAddress: string,
    startTime: DateTime,
    endTime: DateTime,
    chain: string = 'solana',
    options: OHLCVEngineFetchOptions = {}
  ): Promise<OHLCVFetchResult> {
    // Normalize chain to lowercase
    const normalizedChain = normalizeChain(chain);
    return this.query(tokenAddress, startTime, endTime, normalizedChain, options);
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
    options: OHLCVEngineFetchOptions = {}
  ): Promise<Map<string, OHLCVFetchResult>> {
    // Normalize chain to lowercase
    const normalizedChain = normalizeChain(chain);
    const results = new Map<string, OHLCVFetchResult>();

    logger.info(`OHLCV Engine: Batch fetching ${tokens.length} tokens`);

    for (const token of tokens) {
      try {
        const result = await this.fetch(token, startTime, endTime, normalizedChain, options);
        results.set(token, result);
      } catch (error: unknown) {
        logger.error(`OHLCV Engine: Failed to fetch ${token}...`, error as Error);
        results.set(token, {
          candles: [],
          fromCache: false,
          ingestedToClickHouse: false,
          source: 'api',
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
      totalCandles,
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
