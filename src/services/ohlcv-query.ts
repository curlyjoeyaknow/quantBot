import { influxDBClient, OHLCVData, TokenInfo } from '../storage/influxdb-client';
import { ohlcvCache } from '../cache/ohlcv-cache';

export interface QueryOptions {
  useCache?: boolean;
  cacheTTL?: number; // in minutes
  aggregation?: 'none' | '5m' | '15m' | '1h' | '4h' | '1d';
}

export class OHLCVQueryService {
  private influxClient = influxDBClient;
  private cache = ohlcvCache;

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
          console.log(`🎯 Returning cached OHLCV data for ${tokenAddress}`);
          return cachedData;
        }
      }

      // Query from InfluxDB
      console.log(`🔍 Querying OHLCV data from InfluxDB for ${tokenAddress}`);
      const data = await this.influxClient.getOHLCVData(tokenAddress, startTime, endTime, interval);

      // Cache the data if enabled
      if (useCache && data.length > 0) {
        this.cache.set(tokenAddress, startTime, endTime, data, interval, cacheTTL);
      }

      return data;

    } catch (error: any) {
      console.error(`❌ Failed to get OHLCV data for ${tokenAddress}:`, error.message);
      return [];
    }
  }

  /**
   * Get latest price for a token
   */
  async getLatestPrice(tokenAddress: string): Promise<number> {
    try {
      return await this.influxClient.getLatestPrice(tokenAddress);
    } catch (error: any) {
      console.error(`❌ Failed to get latest price for ${tokenAddress}:`, error.message);
      return 0;
    }
  }

  /**
   * Check if data exists for token in time range
   */
  async hasData(tokenAddress: string, startTime: Date, endTime: Date): Promise<boolean> {
    try {
      return await this.influxClient.hasData(tokenAddress, startTime, endTime);
    } catch (error: any) {
      console.error(`❌ Failed to check data existence for ${tokenAddress}:`, error.message);
      return false;
    }
  }

  /**
   * Get all tokens with available data
   */
  async getAvailableTokens(): Promise<TokenInfo[]> {
    try {
      return await this.influxClient.getAvailableTokens();
    } catch (error: any) {
      console.error('❌ Failed to get available tokens:', error.message);
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
      
      if (aggregation === 'none' || data.length === 0) {
        return data;
      }

      return this.aggregateData(data, aggregation);

    } catch (error: any) {
      console.error(`❌ Failed to get aggregated OHLCV data for ${tokenAddress}:`, error.message);
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
      '1d': 24 * 60 * 60 * 1000
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
    const high = Math.max(...candles.map(c => c.high));
    const low = Math.min(...candles.map(c => c.low));
    const volume = candles.reduce((sum, c) => sum + c.volume, 0);

    return {
      timestamp: firstCandle.timestamp,
      dateTime: firstCandle.dateTime,
      open,
      high,
      low,
      close,
      volume
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
    console.log(`🚀 Pre-fetching OHLCV data for simulation: ${tokens.length} tokens`);
    
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
      results.set(token, data);
    }

    console.log(`✅ Pre-fetch complete: ${results.size}/${tokens.length} tokens ready`);
    return results;
  }

  /**
   * Get query statistics
   */
  getQueryStats(): {
    cacheStats: any;
    cacheInfo: any;
  } {
    return {
      cacheStats: this.cache.getStats(),
      cacheInfo: this.cache.getCacheInfo()
    };
  }

  /**
   * Clear query cache
   */
  clearCache(): void {
    this.cache.clear();
    console.log('🧹 Query cache cleared');
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
