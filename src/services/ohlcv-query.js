"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ohlcvQuery = exports.OHLCVQueryService = void 0;
const influxdb_client_1 = require("../storage/influxdb-client");
const ohlcv_cache_1 = require("../cache/ohlcv-cache");
const logger_1 = require("../utils/logger");
class OHLCVQueryService {
    constructor() {
        this.influxClient = influxdb_client_1.influxDBClient;
        this.cache = ohlcv_cache_1.ohlcvCache;
    }
    /**
     * Get OHLCV data for simulation
     */
    async getOHLCV(tokenAddress, startTime, endTime, interval = '1m', options = {}) {
        const { useCache = true, cacheTTL = 60 } = options;
        try {
            // Check cache first if enabled
            if (useCache) {
                const cachedData = this.cache.get(tokenAddress, startTime, endTime, interval);
                if (cachedData) {
                    logger_1.logger.debug('Returning cached OHLCV data', { tokenAddress });
                    return cachedData;
                }
            }
            // Query from InfluxDB
            logger_1.logger.debug('Querying OHLCV data from InfluxDB', { tokenAddress });
            const data = await this.influxClient.getOHLCVData(tokenAddress, startTime, endTime, interval);
            // Cache the data if enabled
            if (useCache && data.length > 0) {
                this.cache.set(tokenAddress, startTime, endTime, data, interval, cacheTTL);
            }
            return data;
        }
        catch (error) {
            logger_1.logger.error('Failed to get OHLCV data', error, { tokenAddress });
            return [];
        }
    }
    /**
     * Get latest price for a token
     */
    async getLatestPrice(tokenAddress) {
        try {
            return await this.influxClient.getLatestPrice(tokenAddress);
        }
        catch (error) {
            logger_1.logger.error('Failed to get latest price', error, { tokenAddress });
            return 0;
        }
    }
    /**
     * Check if data exists for token in time range
     */
    async hasData(tokenAddress, startTime, endTime) {
        try {
            return await this.influxClient.hasData(tokenAddress, startTime, endTime);
        }
        catch (error) {
            logger_1.logger.error('Failed to check data existence', error, { tokenAddress });
            return false;
        }
    }
    /**
     * Get all tokens with available data
     */
    async getAvailableTokens() {
        try {
            return await this.influxClient.getAvailableTokens();
        }
        catch (error) {
            logger_1.logger.error('Failed to get available tokens', error);
            return [];
        }
    }
    /**
     * Get OHLCV data with aggregation
     */
    async getAggregatedOHLCV(tokenAddress, startTime, endTime, aggregation) {
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
            if (aggregation === 'none') {
                return data;
            }
            return this.aggregateData(data, aggregation);
        }
        catch (error) {
            logger_1.logger.error('Failed to get aggregated OHLCV data', error, { tokenAddress, aggregation });
            return [];
        }
    }
    /**
     * Aggregate OHLCV data to different timeframes
     */
    aggregateData(data, timeframe) {
        if (data.length === 0)
            return [];
        const intervalMs = this.getIntervalMs(timeframe);
        const aggregated = [];
        let currentBucket = [];
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
            }
            else {
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
    getIntervalMs(timeframe) {
        const intervals = {
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
    createAggregatedCandle(candles) {
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
    async prefetchForSimulation(tokens, startTime, endTime) {
        logger_1.logger.info('Pre-fetching OHLCV data for simulation', { tokenCount: tokens.length });
        const results = new Map();
        // Use cache's prefetch method
        const fetchFunction = async (token, start, end) => {
            return await this.getOHLCV(token, start, end, '1m', { useCache: false });
        };
        const cachedResults = await this.cache.prefetchForSimulation(tokens, startTime, endTime, fetchFunction);
        // Convert cached results to our format
        for (const [token, data] of cachedResults) {
            results.set(token, data);
        }
        logger_1.logger.info('Pre-fetch complete', { readyCount: results.size, totalCount: tokens.length });
        return results;
    }
    /**
     * Get query statistics
     */
    getQueryStats() {
        return {
            cacheStats: this.cache.getStats(),
            cacheInfo: this.cache.getCacheInfo()
        };
    }
    /**
     * Clear query cache
     */
    clearCache() {
        this.cache.clear();
        logger_1.logger.info('Query cache cleared');
    }
    /**
     * Log query statistics
     */
    logStats() {
        this.cache.logStats();
    }
}
exports.OHLCVQueryService = OHLCVQueryService;
// Export singleton instance
exports.ohlcvQuery = new OHLCVQueryService();
//# sourceMappingURL=ohlcv-query.js.map