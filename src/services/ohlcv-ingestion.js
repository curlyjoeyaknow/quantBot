"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ohlcvIngestion = exports.OHLCVIngestionService = void 0;
const influxdb_client_1 = require("../storage/influxdb-client");
const birdeye_client_1 = require("../api/birdeye-client");
const ohlcv_cache_1 = require("../cache/ohlcv-cache");
const logger_1 = require("../utils/logger");
class OHLCVIngestionService {
    constructor() {
        this.influxClient = influxdb_client_1.influxDBClient;
        this.birdeyeClient = birdeye_client_1.birdeyeClient;
        this.cache = ohlcv_cache_1.ohlcvCache;
    }
    /**
     * Initialize the ingestion service
     */
    async initialize() {
        try {
            await this.influxClient.initialize();
            logger_1.logger.info('OHLCV Ingestion Service initialized');
        }
        catch (error) {
            logger_1.logger.error('Failed to initialize OHLCV Ingestion Service', error);
            throw error;
        }
    }
    /**
     * Fetch and store OHLCV for a single token
     */
    async fetchAndStoreOHLCV(tokenAddress, startTime, endTime, tokenSymbol = 'UNKNOWN', chain = 'solana') {
        try {
            logger_1.logger.debug('Fetching OHLCV', { tokenAddress, startTime: startTime.toISOString(), endTime: endTime.toISOString() });
            // Check if data already exists in InfluxDB
            const hasData = await this.influxClient.hasData(tokenAddress, startTime, endTime);
            if (hasData) {
                logger_1.logger.debug('Data already exists in InfluxDB', { tokenAddress });
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
                logger_1.logger.debug('Using cached data', { tokenAddress });
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
                logger_1.logger.warn('No data returned from Birdeye API', { tokenAddress });
                return {
                    tokenAddress,
                    recordsAdded: 0,
                    recordsSkipped: 0,
                    success: false,
                    error: 'No data returned from API'
                };
            }
            // Convert Birdeye format to our OHLCV format
            const ohlcvData = birdeyeData.items.map(item => ({
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
            logger_1.logger.info('Successfully stored OHLCV records', { tokenAddress, recordCount: ohlcvData.length });
            return {
                tokenAddress,
                recordsAdded: ohlcvData.length,
                recordsSkipped: 0,
                success: true
            };
        }
        catch (error) {
            logger_1.logger.error('Failed to fetch and store OHLCV', error, { tokenAddress });
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
    async batchFetchOHLCV(tokens, startTime, endTime) {
        logger_1.logger.info('Batch fetching OHLCV', { tokenCount: tokens.length });
        const results = new Map();
        const batchSize = 3; // Reduced to 3 tokens at a time to conserve credits
        for (let i = 0; i < tokens.length; i += batchSize) {
            const batch = tokens.slice(i, i + batchSize);
            const promises = batch.map(async (token) => {
                try {
                    const result = await this.fetchAndStoreOHLCV(token.address, startTime, endTime, token.symbol, token.chain);
                    if (result.success && result.recordsAdded > 0) {
                        // Get the data from InfluxDB to return
                        const data = await this.influxClient.getOHLCVData(token.address, startTime, endTime);
                        if (data) {
                            results.set(token.address, data);
                        }
                    }
                }
                catch (error) {
                    logger_1.logger.error('Batch fetch failed', error, { tokenAddress: token.address });
                }
            });
            await Promise.all(promises);
            // Longer delay between batches to conserve credits
            if (i + batchSize < tokens.length) {
                await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
            }
        }
        logger_1.logger.info('Batch fetch complete', { processedCount: results.size, totalCount: tokens.length });
        return results;
    }
    /**
     * Backfill missing data for existing tokens
     */
    async backfillMissingData(tokenAddress) {
        try {
            logger_1.logger.debug('Backfilling missing data', { tokenAddress });
            // Get existing data range
            const existingData = await this.influxClient.getOHLCVData(tokenAddress, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
            new Date());
            if (existingData.length === 0) {
                // No existing data, fetch last 7 days
                const endTime = new Date();
                const startTime = new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000);
                return await this.fetchAndStoreOHLCV(tokenAddress, startTime, endTime);
            }
            // Find gaps in existing data
            const gaps = this.findDataGaps(existingData);
            if (gaps.length === 0) {
                logger_1.logger.debug('No gaps found', { tokenAddress });
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
        }
        catch (error) {
            logger_1.logger.error('Failed to backfill data', error, { tokenAddress });
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
    findDataGaps(data) {
        if (data.length < 2)
            return [];
        const gaps = [];
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
    getIngestionStats() {
        return {
            apiUsage: this.birdeyeClient.getAPIKeyUsage(),
            cacheStats: this.cache.getStats(),
            influxRecordCount: 0 // Would need to implement this in InfluxDB client
        };
    }
    /**
     * Close connections
     */
    async close() {
        await this.influxClient.close();
        logger_1.logger.info('OHLCV Ingestion Service closed');
    }
}
exports.OHLCVIngestionService = OHLCVIngestionService;
// Export singleton instance
exports.ohlcvIngestion = new OHLCVIngestionService();
//# sourceMappingURL=ohlcv-ingestion.js.map