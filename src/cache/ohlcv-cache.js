"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ohlcvCache = exports.OHLCVCache = void 0;
const lru_cache_1 = require("lru-cache");
const logger_1 = require("../utils/logger");
class OHLCVCache {
    constructor(maxSize = 2000) {
        this.cache = new lru_cache_1.LRUCache({
            max: maxSize,
            ttl: 1000 * 60 * 30, // 30 minutes default TTL (increased for credit conservation)
            updateAgeOnGet: true,
            updateAgeOnHas: true
        });
        this.stats = {
            hits: 0,
            misses: 0,
            sets: 0,
            deletes: 0,
            hitRate: 0
        };
        logger_1.logger.info('OHLCV Cache initialized', { maxSize, ttl: '30min' });
    }
    /**
     * Generate cache key for OHLCV query
     */
    generateCacheKey(tokenAddress, startTime, endTime, interval = '1m') {
        const startUnix = Math.floor(startTime.getTime() / 1000);
        const endUnix = Math.floor(endTime.getTime() / 1000);
        return `${tokenAddress.toLowerCase()}:${startUnix}:${endUnix}:${interval}`;
    }
    /**
     * Get OHLCV data from cache
     */
    get(tokenAddress, startTime, endTime, interval = '1m') {
        const key = this.generateCacheKey(tokenAddress, startTime, endTime, interval);
        const entry = this.cache.get(key);
        if (entry) {
            // Check if entry is still valid
            const now = Date.now();
            if (now - entry.timestamp < entry.ttl) {
                this.stats.hits++;
                this.updateHitRate();
                logger_1.logger.debug('Cache HIT', { tokenAddress, startTime: startTime.toISOString(), endTime: endTime.toISOString() });
                return entry.data;
            }
            else {
                // Entry expired, remove it
                this.cache.delete(key);
                this.stats.deletes++;
            }
        }
        this.stats.misses++;
        this.updateHitRate();
        logger_1.logger.debug('Cache MISS', { tokenAddress, startTime: startTime.toISOString(), endTime: endTime.toISOString() });
        return null;
    }
    /**
     * Set OHLCV data in cache
     */
    set(tokenAddress, startTime, endTime, data, interval = '1m', ttlMinutes = 5) {
        const key = this.generateCacheKey(tokenAddress, startTime, endTime, interval);
        const ttl = ttlMinutes * 60 * 1000; // Convert to milliseconds
        const entry = {
            data,
            timestamp: Date.now(),
            ttl
        };
        this.cache.set(key, entry);
        this.stats.sets++;
        logger_1.logger.debug('Cache SET', { tokenAddress, recordCount: data.length, ttlMinutes });
    }
    /**
     * Check if data exists in cache
     */
    has(tokenAddress, startTime, endTime, interval = '1m') {
        const key = this.generateCacheKey(tokenAddress, startTime, endTime, interval);
        return this.cache.has(key);
    }
    /**
     * Delete specific cache entry
     */
    delete(tokenAddress, startTime, endTime, interval = '1m') {
        const key = this.generateCacheKey(tokenAddress, startTime, endTime, interval);
        const deleted = this.cache.delete(key);
        if (deleted) {
            this.stats.deletes++;
            logger_1.logger.debug('Cache DELETE', { tokenAddress });
        }
        return deleted;
    }
    /**
     * Clear all cache entries
     */
    clear() {
        this.cache.clear();
        logger_1.logger.info('Cache cleared');
    }
    /**
     * Get cache statistics
     */
    getStats() {
        return { ...this.stats };
    }
    /**
     * Update hit rate calculation
     */
    updateHitRate() {
        const total = this.stats.hits + this.stats.misses;
        this.stats.hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;
    }
    /**
     * Get cache size and capacity info
     */
    getCacheInfo() {
        const size = this.cache.size;
        const maxSize = this.cache.max;
        const utilization = (size / maxSize) * 100;
        return {
            size,
            maxSize,
            utilization
        };
    }
    /**
     * Pre-fetch data for simulation (batch caching)
     */
    async prefetchForSimulation(tokens, startTime, endTime, fetchFunction) {
        logger_1.logger.info('Pre-fetching OHLCV data', { tokenCount: tokens.length });
        const results = new Map();
        const promises = tokens.map(async (token) => {
            try {
                // Check cache first
                const cachedData = this.get(token, startTime, endTime);
                if (cachedData) {
                    results.set(token, cachedData);
                    return;
                }
                // Fetch from source
                const data = await fetchFunction(token, startTime, endTime);
                if (data && data.length > 0) {
                    // Cache the data
                    this.set(token, startTime, endTime, data, '1m', 60); // 1 hour TTL for simulation data
                    results.set(token, data);
                }
            }
            catch (error) {
                logger_1.logger.error('Failed to pre-fetch data', error, { token });
            }
        });
        await Promise.all(promises);
        logger_1.logger.info('Pre-fetch complete', { cachedCount: results.size, totalCount: tokens.length });
        return results;
    }
    /**
     * Log cache statistics
     */
    logStats() {
        const stats = this.getStats();
        const info = this.getCacheInfo();
        logger_1.logger.info('OHLCV Cache Statistics', {
            hits: stats.hits,
            misses: stats.misses,
            sets: stats.sets,
            deletes: stats.deletes,
            hitRate: stats.hitRate.toFixed(2),
            cacheSize: info.size,
            maxSize: info.maxSize,
            utilization: info.utilization.toFixed(1),
        });
    }
}
exports.OHLCVCache = OHLCVCache;
// Export singleton instance
exports.ohlcvCache = new OHLCVCache();
//# sourceMappingURL=ohlcv-cache.js.map