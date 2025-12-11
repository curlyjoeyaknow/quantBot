/**
 * OhlcvAggregator
 * ---------------
 * Aggregates tick-level price updates into canonical 1-minute candles and
 * persists them to ClickHouse. Derived intervals are produced by combining
 * freshly written 1-minute candles to avoid redundant API calls.
 */
export declare class OhlcvAggregator {
    private readonly buckets;
    private flushTimer;
    private readonly flushIntervalMs;
    private readonly baseIntervalMs;
    constructor(flushIntervalMs?: number);
    /**
     * Begin periodic flushing of completed buckets.
     */
    start(): void;
    /**
     * Stop periodic flushing.
     */
    stop(): void;
    /**
     * Ingest a tick into the in-memory bucket for the token.
     */
    ingestTick(tokenAddress: string, chain: string, tick: {
        timestamp: number;
        price: number;
        volume?: number;
    }): void;
    /**
     * Flush all completed buckets (older than current minute) to ClickHouse.
     */
    flushCompletedBuckets(nowMs: number): Promise<void>;
    private getTokenKey;
    private getOrCreateBuckets;
}
export declare const ohlcvAggregator: OhlcvAggregator;
//# sourceMappingURL=ohlcv-aggregator.d.ts.map