"use strict";
/**
 * OHLCV Data Management Service
 *
 * Centralized service for fetching, ingesting, and caching OHLCV candles.
 * Provides multi-layer caching (in-memory → ClickHouse → CSV cache) and
 * integrates with Birdeye API and ClickHouse storage.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ohlcvService = exports.OHLCVService = void 0;
const luxon_1 = require("luxon");
const birdeye_client_1 = require("../api/birdeye-client");
const clickhouse_client_1 = require("../storage/clickhouse-client");
const candles_1 = require("../simulation/candles");
const logger_1 = require("../utils/logger");
/**
 * OHLCV Service for managing candle data
 */
class OHLCVService {
    constructor() {
        this.birdeyeClient = birdeye_client_1.birdeyeClient;
        this.inMemoryCache = new Map();
        this.cacheTTL = 5 * 60 * 1000; // 5 minutes
    }
    /**
     * Initialize the service (ensure ClickHouse is ready)
     */
    async initialize() {
        try {
            await (0, clickhouse_client_1.initClickHouse)();
            logger_1.logger.info('OHLCV Service initialized');
        }
        catch (error) {
            logger_1.logger.error('Failed to initialize OHLCV Service', error);
            throw error;
        }
    }
    /**
     * Fetch candles from Birdeye API
     */
    async fetchCandles(mint, chain, startTime, endTime, interval = '5m') {
        try {
            logger_1.logger.debug('Fetching candles from Birdeye', {
                mint: mint.substring(0, 20),
                chain,
                startTime: startTime.toISO(),
                endTime: endTime.toISO(),
                interval,
            });
            const startUnix = Math.floor(startTime.toSeconds());
            const endUnix = Math.floor(endTime.toSeconds());
            // Use Birdeye client to fetch OHLCV data
            const birdeyeData = await this.birdeyeClient.fetchOHLCVData(mint, new Date(startUnix * 1000), new Date(endUnix * 1000), interval);
            if (!birdeyeData || !birdeyeData.items || birdeyeData.items.length === 0) {
                logger_1.logger.warn('No data returned from Birdeye API', { mint: mint.substring(0, 20) });
                return [];
            }
            // Convert Birdeye format to Candle format
            const candles = birdeyeData.items
                .map((item) => ({
                timestamp: item.unixTime,
                open: parseFloat(item.open) || 0,
                high: parseFloat(item.high) || 0,
                low: parseFloat(item.low) || 0,
                close: parseFloat(item.close) || 0,
                volume: parseFloat(item.volume) || 0,
            }))
                .filter((c) => c.timestamp >= startUnix && c.timestamp <= endUnix)
                .sort((a, b) => a.timestamp - b.timestamp);
            logger_1.logger.debug('Fetched candles from Birdeye', {
                mint: mint.substring(0, 20),
                count: candles.length,
            });
            return candles;
        }
        catch (error) {
            logger_1.logger.error('Failed to fetch candles from Birdeye', error, {
                mint: mint.substring(0, 20),
            });
            throw error;
        }
    }
    /**
     * Ingest candles into ClickHouse
     */
    async ingestCandles(mint, chain, candles, options = {}) {
        const { interval = '5m', skipDuplicates = true } = options;
        if (candles.length === 0) {
            return { ingested: 0, skipped: 0 };
        }
        try {
            // Check for existing data if skipDuplicates is enabled
            if (skipDuplicates && candles.length > 0) {
                const firstCandle = luxon_1.DateTime.fromSeconds(candles[0].timestamp);
                const lastCandle = luxon_1.DateTime.fromSeconds(candles[candles.length - 1].timestamp);
                const existing = await (0, clickhouse_client_1.hasCandles)(mint, chain, firstCandle, lastCandle);
                if (existing) {
                    logger_1.logger.debug('Candles already exist in ClickHouse, skipping', {
                        mint: mint.substring(0, 20),
                        count: candles.length,
                    });
                    return { ingested: 0, skipped: candles.length };
                }
            }
            await (0, clickhouse_client_1.insertCandles)(mint, chain, candles, interval);
            logger_1.logger.info('Ingested candles into ClickHouse', {
                mint: mint.substring(0, 20),
                count: candles.length,
                interval,
            });
            return { ingested: candles.length, skipped: 0 };
        }
        catch (error) {
            logger_1.logger.error('Failed to ingest candles', error, {
                mint: mint.substring(0, 20),
            });
            throw error;
        }
    }
    /**
     * Get candles with multi-layer caching
     * Priority: in-memory → ClickHouse → Birdeye API
     */
    async getCandles(mint, chain, startTime, endTime, options = {}) {
        const { interval = '5m', useCache = true, forceRefresh = false, alertTime, } = options;
        // Check in-memory cache first
        if (useCache && !forceRefresh) {
            const cacheKey = this.getCacheKey(mint, chain, startTime, endTime, interval);
            const cached = this.inMemoryCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
                logger_1.logger.debug('Using in-memory cache', { mint: mint.substring(0, 20) });
                return cached.candles;
            }
        }
        // Try ClickHouse
        if (useCache && !forceRefresh) {
            try {
                const clickhouseCandles = await (0, clickhouse_client_1.queryCandles)(mint, chain, startTime, endTime, interval);
                if (clickhouseCandles.length > 0) {
                    logger_1.logger.debug('Using ClickHouse cache', {
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
            }
            catch (error) {
                logger_1.logger.warn('ClickHouse query failed, falling back to API', {
                    error: error.message,
                    mint: mint.substring(0, 20),
                });
            }
        }
        // Fall back to fetchHybridCandles (which uses CSV cache and Birdeye API)
        try {
            const candles = await (0, candles_1.fetchHybridCandles)(mint, startTime, endTime, chain, alertTime);
            // Ingest into ClickHouse for future use
            if (candles.length > 0 && useCache) {
                try {
                    await this.ingestCandles(mint, chain, candles, { interval, skipDuplicates: true });
                }
                catch (error) {
                    logger_1.logger.warn('Failed to ingest candles to ClickHouse', {
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
        }
        catch (error) {
            logger_1.logger.error('Failed to get candles', error, {
                mint: mint.substring(0, 20),
            });
            throw error;
        }
    }
    /**
     * Fetch and ingest candles in one operation
     */
    async fetchAndIngest(mint, chain, startTime, endTime, options = {}) {
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
    clearCache() {
        this.inMemoryCache.clear();
        logger_1.logger.debug('In-memory cache cleared');
    }
    /**
     * Get cache statistics
     */
    getCacheStats() {
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
    getCacheKey(mint, chain, startTime, endTime, interval) {
        return `${chain}:${mint}:${startTime.toISO()}:${endTime.toISO()}:${interval}`;
    }
}
exports.OHLCVService = OHLCVService;
// Export singleton instance
exports.ohlcvService = new OHLCVService();
//# sourceMappingURL=ohlcv-service.js.map