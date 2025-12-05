import { influxDBClient, OHLCVData } from '@quantbot/storage';
import { logger } from '@quantbot/utils';

// TODO: External API clients should be injected as dependencies
// import { birdeyeClient, BirdeyeOHLCVResponse } from '@quantbot/external-apis';
// import { ohlcvCache } from '@quantbot/cache';

export interface IngestionResult {
  tokenAddress: string;
  recordsAdded: number;
  recordsSkipped: number;
  success: boolean;
  error?: string;
}

export class OHLCVIngestionService {
  private influxClient = influxDBClient;
  private birdeyeClient = birdeyeClient;
  private cache = ohlcvCache;

  /**
   * Initialize the ingestion service
   */
  async initialize(): Promise<void> {
    try {
      await this.influxClient.initialize();
      logger.info('OHLCV Ingestion Service initialized');
    } catch (error) {
      logger.error('Failed to initialize OHLCV Ingestion Service', error as Error);
      throw error;
    }
  }

  /**
   * Fetch and store OHLCV for a single token
   */
  async fetchAndStoreOHLCV(
    tokenAddress: string, 
    startTime: Date, 
    endTime: Date,
    tokenSymbol: string = 'UNKNOWN',
    chain: string = 'solana'
  ): Promise<IngestionResult> {
    try {
      logger.debug('Fetching OHLCV', { tokenAddress, startTime: startTime.toISOString(), endTime: endTime.toISOString() });

      // Check if data already exists in InfluxDB
      const hasData = await this.influxClient.hasData(tokenAddress, startTime, endTime);
      if (hasData) {
        logger.debug('Data already exists in InfluxDB', { tokenAddress });
        return {
          tokenAddress,
          recordsAdded: 0,
          recordsSkipped: 0,
          success: true
        };
      }

      // Check cache first
      const cachedData = this.cache.get(tokenAddress, startTime, endTime);
      if (cachedData) {
        logger.debug('Using cached data', { tokenAddress });
        await this.influxClient.writeOHLCVData(tokenAddress, tokenSymbol, chain, cachedData);
        return {
          tokenAddress,
          recordsAdded: cachedData.length,
          recordsSkipped: 0,
          success: true
        };
      }

      // Fetch from Birdeye API
      const birdeyeData = await this.birdeyeClient.fetchOHLCVData(tokenAddress, startTime, endTime);
      
      if (!birdeyeData || !birdeyeData.items || birdeyeData.items.length === 0) {
        logger.warn('No data returned from Birdeye API', { tokenAddress });
        return {
          tokenAddress,
          recordsAdded: 0,
          recordsSkipped: 0,
          success: false,
          error: 'No data returned from API'
        };
      }

      // Convert Birdeye format to our OHLCV format
      const ohlcvData: OHLCVData[] = birdeyeData.items.map(item => ({
        timestamp: item.unixTime * 1000, // Convert to milliseconds
        dateTime: new Date(item.unixTime * 1000),
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
        volume: item.volume || 0
      }));

      // Write to InfluxDB
      await this.influxClient.writeOHLCVData(tokenAddress, tokenSymbol, chain, ohlcvData);

      // Cache the data with longer TTL for credit conservation
      this.cache.set(tokenAddress, startTime, endTime, ohlcvData, '1m', 120); // 2 hours TTL

      logger.info('Successfully stored OHLCV records', { tokenAddress, recordCount: ohlcvData.length });

      return {
        tokenAddress,
        recordsAdded: ohlcvData.length,
        recordsSkipped: 0,
        success: true
      };

    } catch (error: any) {
      logger.error('Failed to fetch and store OHLCV', error as Error, { tokenAddress });
      return {
        tokenAddress,
        recordsAdded: 0,
        recordsSkipped: 0,
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Batch fetch for multiple tokens (used in simulations)
   */
  async batchFetchOHLCV(
    tokens: Array<{ address: string; symbol: string; chain: string }>, 
    startTime: Date, 
    endTime: Date
  ): Promise<Map<string, OHLCVData[]>> {
    logger.info('Batch fetching OHLCV', { tokenCount: tokens.length });
    
    const results = new Map<string, OHLCVData[]>();
    const batchSize = 3; // Reduced to 3 tokens at a time to conserve credits
    
    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);
      
      const promises = batch.map(async (token) => {
        try {
          const result = await this.fetchAndStoreOHLCV(
            token.address, 
            startTime, 
            endTime, 
            token.symbol, 
            token.chain
          );
          
          if (result.success && result.recordsAdded > 0) {
            // Get the data from InfluxDB to return
            const data = await this.influxClient.getOHLCVData(token.address, startTime, endTime);
            if (data) {
              results.set(token.address, data);
            }
          }
        } catch (error) {
          logger.error('Batch fetch failed', error as Error, { tokenAddress: token.address });
        }
      });

      await Promise.all(promises);
      
      // Longer delay between batches to conserve credits
      if (i + batchSize < tokens.length) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
      }
    }

    logger.info('Batch fetch complete', { processedCount: results.size, totalCount: tokens.length });
    return results;
  }

  /**
   * Backfill missing data for existing tokens
   */
  async backfillMissingData(tokenAddress: string): Promise<IngestionResult> {
    try {
      logger.debug('Backfilling missing data', { tokenAddress });

      // Get existing data range
      const existingData = await this.influxClient.getOHLCVData(
        tokenAddress, 
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
        new Date()
      );

      if (existingData.length === 0) {
        // No existing data, fetch last 7 days
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000);
        
        return await this.fetchAndStoreOHLCV(tokenAddress, startTime, endTime);
      }

      // Find gaps in existing data
      const gaps = this.findDataGaps(existingData);
      
      if (gaps.length === 0) {
        logger.debug('No gaps found', { tokenAddress });
        return {
          tokenAddress,
          recordsAdded: 0,
          recordsSkipped: 0,
          success: true
        };
      }

      // Fill gaps
      let totalAdded = 0;
      for (const gap of gaps) {
        const result = await this.fetchAndStoreOHLCV(tokenAddress, gap.start, gap.end);
        if (result.success) {
          totalAdded += result.recordsAdded;
        }
      }

      return {
        tokenAddress,
        recordsAdded: totalAdded,
        recordsSkipped: 0,
        success: true
      };

    } catch (error: any) {
      logger.error('Failed to backfill data', error as Error, { tokenAddress });
      return {
        tokenAddress,
        recordsAdded: 0,
        recordsSkipped: 0,
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Find gaps in OHLCV data
   */
  private findDataGaps(data: OHLCVData[]): Array<{ start: Date; end: Date }> {
    if (data.length < 2) return [];

    const gaps: Array<{ start: Date; end: Date }> = [];
    const expectedInterval = 60 * 1000; // 1 minute in milliseconds

    for (let i = 0; i < data.length - 1; i++) {
      const currentTime = data[i].timestamp;
      const nextTime = data[i + 1].timestamp;
      const gap = nextTime - currentTime;

      // If gap is more than 2 minutes, consider it a gap
      if (gap > expectedInterval * 2) {
        gaps.push({
          start: new Date(currentTime + expectedInterval),
          end: new Date(nextTime - expectedInterval)
        });
      }
    }

    return gaps;
  }

  /**
   * Get ingestion statistics
   */
  getIngestionStats(): {
    apiUsage: any;
    cacheStats: any;
    influxRecordCount: number;
  } {
    return {
      apiUsage: this.birdeyeClient.getAPIKeyUsage(),
      cacheStats: this.cache.getStats(),
      influxRecordCount: 0 // Would need to implement this in InfluxDB client
    };
  }

  /**
   * Close connections
   */
  async close(): Promise<void> {
    await this.influxClient.close();
    logger.info('OHLCV Ingestion Service closed');
  }
}

// Export singleton instance
export const ohlcvIngestion = new OHLCVIngestionService();
