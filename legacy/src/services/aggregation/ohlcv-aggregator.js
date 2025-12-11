"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ohlcvAggregator = exports.OhlcvAggregator = void 0;
const clickhouse_client_1 = require("../../storage/clickhouse-client");
const logger_1 = require("../../utils/logger");
/**
 * OhlcvAggregator
 * ---------------
 * Aggregates tick-level price updates into canonical 1-minute candles and
 * persists them to ClickHouse. Derived intervals are produced by combining
 * freshly written 1-minute candles to avoid redundant API calls.
 */
class OhlcvAggregator {
    constructor(flushIntervalMs = 5000) {
        this.buckets = new Map();
        this.flushTimer = null;
        this.baseIntervalMs = 60000;
        this.flushIntervalMs = flushIntervalMs;
    }
    /**
     * Begin periodic flushing of completed buckets.
     */
    start() {
        if (this.flushTimer)
            return;
        this.flushTimer = setInterval(() => {
            void this.flushCompletedBuckets(Date.now());
        }, this.flushIntervalMs);
    }
    /**
     * Stop periodic flushing.
     */
    stop() {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
    }
    /**
     * Ingest a tick into the in-memory bucket for the token.
     */
    ingestTick(tokenAddress, chain, tick) {
        if (!tick.price || !Number.isFinite(tick.price)) {
            return;
        }
        const key = this.getTokenKey(tokenAddress, chain);
        const bucketStart = Math.floor(tick.timestamp / 60) * 60;
        const buckets = this.getOrCreateBuckets(key);
        const accumulator = buckets.get(bucketStart) ?? {
            open: tick.price,
            high: tick.price,
            low: tick.price,
            close: tick.price,
            volume: 0,
            startTimestamp: bucketStart,
            lastTimestamp: tick.timestamp,
        };
        accumulator.close = tick.price;
        accumulator.high = Math.max(accumulator.high, tick.price);
        accumulator.low = Math.min(accumulator.low, tick.price);
        accumulator.volume += tick.volume ?? 0;
        accumulator.lastTimestamp = tick.timestamp;
        buckets.set(bucketStart, accumulator);
    }
    /**
     * Flush all completed buckets (older than current minute) to ClickHouse.
     */
    async flushCompletedBuckets(nowMs) {
        const cutoffUnix = Math.floor(nowMs / 1000) - 60; // keep current minute hot
        const flushPromises = [];
        for (const [tokenKey, bucketMap] of this.buckets) {
            const [chain, token] = tokenKey.split(':');
            const readyBuckets = Array.from(bucketMap.entries()).filter(([startTimestamp]) => startTimestamp <= cutoffUnix);
            if (!readyBuckets.length)
                continue;
            const candles = readyBuckets
                .sort((a, b) => a[0] - b[0])
                .map(([startTimestamp, bucket]) => ({
                timestamp: startTimestamp,
                open: bucket.open,
                high: bucket.high,
                low: bucket.low,
                close: bucket.close,
                volume: bucket.volume,
            }));
            readyBuckets.forEach(([startTimestamp]) => bucketMap.delete(startTimestamp));
            flushPromises.push((0, clickhouse_client_1.insertCandles)(token, chain, candles, '1m').catch((error) => {
                logger_1.logger.error('Failed to insert aggregated candles', error, {
                    token: token.substring(0, 20),
                    count: candles.length,
                });
            }));
        }
        await Promise.all(flushPromises);
    }
    getTokenKey(tokenAddress, chain) {
        return `${chain}:${tokenAddress}`;
    }
    getOrCreateBuckets(key) {
        if (!this.buckets.has(key)) {
            this.buckets.set(key, new Map());
        }
        return this.buckets.get(key);
    }
}
exports.OhlcvAggregator = OhlcvAggregator;
exports.ohlcvAggregator = new OhlcvAggregator();
//# sourceMappingURL=ohlcv-aggregator.js.map