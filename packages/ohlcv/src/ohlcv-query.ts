import {
  influxDBClient,
  OHLCVData,
  TokenInfo,
  type OhlcvCacheCandle,
  getStorageEngine,
  ohlcvCache,
} from '@quantbot/storage';
import { logger } from '@quantbot/utils';
import { DateTime } from 'luxon';
import type { Candle } from '@quantbot/core';

export interface QueryOptions {
  useCache?: boolean;
  cacheTTL?: number; // in minutes
  aggregation?: 'none' | '5m' | '15m' | '1h' | '4h' | '1d';
}

export class OHLCVQueryService {
  private influxClient = influxDBClient;
  private cache = ohlcvCache;
  private storageEngine = getStorageEngine();

  /**
   * Convert OhlcvCacheCandle to OHLCVData, ensuring dateTime is set
   */
  private convertCacheCandleToOHLCVData(candle: OhlcvCacheCandle): OHLCVData {
    return {
      timestamp: candle.timestamp,
      dateTime: candle.dateTime || new Date(candle.timestamp),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    };
  }

  /**
   * Get OHLCV data for simulation
   */
  async getOHLCV(
    tokenAddress: string,
    startTime: Date,
    endTime: Date,
    interval: string = '1m',
    options: QueryOptions = {}
  ): Promise<OHLCVData[]> {
    const { useCache = true, cacheTTL = 60 } = options;

    try {
      // Check cache first if enabled
      if (useCache) {
        const cachedData = this.cache.get(tokenAddress, startTime, endTime, interval);
        if (cachedData) {
          logger.debug('Returning cached OHLCV data', { tokenAddress });
          return cachedData.map((candle: OhlcvCacheCandle) =>
            this.convertCacheCandleToOHLCVData(candle)
          );
        }
      }

      // Query ClickHouse via StorageEngine
      try {
        const startDateTime = DateTime.fromJSDate(startTime);
        const endDateTime = DateTime.fromJSDate(endTime);

        // Default to 'solana' chain if not specified
        // Note: This is a limitation - we should accept chain as a parameter
        const chain = 'solana';

        const candles = await this.storageEngine.getCandles(
          tokenAddress,
          chain,
          startDateTime,
          endDateTime,
          { interval, useCache: false } // Don't use StorageEngine cache, we handle caching here
        );

        // Convert Candle[] (timestamp in seconds) to OHLCVData[] (timestamp in milliseconds, with dateTime)
        const data: OHLCVData[] = candles.map((candle: Candle) => ({
          timestamp: candle.timestamp * 1000, // Convert seconds to milliseconds
          dateTime: new Date(candle.timestamp * 1000), // Convert seconds to Date
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        }));

        // Cache the data if enabled
        if (useCache && data.length > 0) {
          this.cache.set(tokenAddress, startTime, endTime, data, interval, cacheTTL);
        }

        return data;
      } catch (error: unknown) {
        logger.error('Failed to query ClickHouse for OHLCV data', error as Error, { tokenAddress });
        // Return empty array on error (graceful degradation)
        return [];
      }
    } catch (error: unknown) {
      logger.error('Failed to get OHLCV data', error as Error, { tokenAddress });
      return [];
    }
  }

  /**
   * Get latest price for a token
   */
  async getLatestPrice(tokenAddress: string): Promise<number> {
    try {
      return await this.influxClient.getLatestPrice(tokenAddress);
    } catch (error: unknown) {
      logger.error('Failed to get latest price', error as Error, { tokenAddress });
      return 0;
    }
  }

  /**
   * Check if data exists for token in time range
   */
  async hasData(tokenAddress: string, startTime: Date, endTime: Date): Promise<boolean> {
    try {
      return await this.influxClient.hasData(tokenAddress, startTime, endTime);
    } catch (error: unknown) {
      logger.error('Failed to check data existence', error as Error, { tokenAddress });
      return false;
    }
  }

  /**
   * Get all tokens with available data
   */
  async getAvailableTokens(): Promise<TokenInfo[]> {
    try {
      return await this.influxClient.getAvailableTokens();
    } catch (error: unknown) {
      logger.error('Failed to get available tokens', error as Error);
      return [];
    }
  }

  /**
   * Get OHLCV data with aggregation
   */
  async getAggregatedOHLCV(
    tokenAddress: string,
    startTime: Date,
    endTime: Date,
    aggregation: '5m' | '15m' | '1h' | '4h' | '1d'
  ): Promise<OHLCVData[]> {
    try {
      // For now, return 1-minute data and let the caller aggregate
      // In a full implementation, this would use InfluxDB's aggregation functions
      const data = await this.getOHLCV(tokenAddress, startTime, endTime, '1m');

      if (data.length === 0) {
        return data;
      }
      if (!aggregation) {
        return data;
      }
      // TypeScript doesn't know 'none' is in the union, but it's checked at runtime
      if ((aggregation as string) === 'none') {
        return data;
      }

      return this.aggregateData(data, aggregation);
    } catch (error: unknown) {
      logger.error('Failed to get aggregated OHLCV data', error as Error, {
        tokenAddress,
        aggregation,
      });
      return [];
    }
  }

  /**
   * Aggregate OHLCV data to different timeframes
   */
  private aggregateData(data: OHLCVData[], timeframe: string): OHLCVData[] {
    if (data.length === 0) return [];

    const intervalMs = this.getIntervalMs(timeframe);
    const aggregated: OHLCVData[] = [];

    let currentBucket: OHLCVData[] = [];
    let bucketStart = data[0].timestamp;

    for (const candle of data) {
      if (candle.timestamp >= bucketStart + intervalMs) {
        // Process current bucket
        if (currentBucket.length > 0) {
          aggregated.push(this.createAggregatedCandle(currentBucket));
        }

        // Start new bucket
        currentBucket = [candle];
        bucketStart = Math.floor(candle.timestamp / intervalMs) * intervalMs;
      } else {
        currentBucket.push(candle);
      }
    }

    // Process last bucket
    if (currentBucket.length > 0) {
      aggregated.push(this.createAggregatedCandle(currentBucket));
    }

    return aggregated;
  }

  /**
   * Get interval in milliseconds
   */
  private getIntervalMs(timeframe: string): number {
    const intervals: Record<string, number> = {
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
    };

    return intervals[timeframe] || 60 * 1000; // Default to 1 minute
  }

  /**
   * Create aggregated candle from multiple candles
   */
  private createAggregatedCandle(candles: OHLCVData[]): OHLCVData {
    const firstCandle = candles[0];
    const lastCandle = candles[candles.length - 1];

    const open = firstCandle.open;
    const close = lastCandle.close;
    const high = Math.max(...candles.map((c) => c.high));
    const low = Math.min(...candles.map((c) => c.low));
    const volume = candles.reduce((sum, c) => sum + c.volume, 0);

    return {
      timestamp: firstCandle.timestamp,
      dateTime: firstCandle.dateTime,
      open,
      high,
      low,
      close,
      volume,
    };
  }

  /**
   * Pre-fetch data for simulation (optimized for batch queries)
   */
  async prefetchForSimulation(
    tokens: string[],
    startTime: Date,
    endTime: Date
  ): Promise<Map<string, OHLCVData[]>> {
    logger.info('Pre-fetching OHLCV data for simulation', { tokenCount: tokens.length });

    const results = new Map<string, OHLCVData[]>();

    // Use cache's prefetch method
    const fetchFunction = async (token: string, start: Date, end: Date) => {
      return await this.getOHLCV(token, start, end, '1m', { useCache: false });
    };

    const cachedResults = await this.cache.prefetchForSimulation(
      tokens,
      startTime,
      endTime,
      fetchFunction
    );

    // Convert cached results to our format
    for (const [token, data] of cachedResults) {
      // Convert OhlcvCacheCandle[] to OHLCVData[]
      const convertedData: OHLCVData[] = data.map((candle: OhlcvCacheCandle) =>
        this.convertCacheCandleToOHLCVData(candle)
      );
      results.set(token, convertedData);
    }

    logger.info('Pre-fetch complete', { readyCount: results.size, totalCount: tokens.length });
    return results;
  }

  /**
   * Get query statistics
   */
  getQueryStats(): {
    cacheStats: Record<string, unknown>;
    cacheInfo: Record<string, unknown>;
  } {
    return {
      cacheStats: this.cache.getStats() as unknown as Record<string, unknown>,
      cacheInfo: this.cache.getCacheInfo(),
    };
  }

  /**
   * Clear query cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('Query cache cleared');
  }

  /**
   * Log query statistics
   */
  logStats(): void {
    this.cache.logStats();
  }
}

// Export singleton instance
export const ohlcvQuery = new OHLCVQueryService();
