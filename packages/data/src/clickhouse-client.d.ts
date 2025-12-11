/**
 * ClickHouse Client for OHLCV Data Storage
 *
 * Provides fast, efficient storage and retrieval of OHLCV candle data
 * using ClickHouse columnar database for time-series data.
 */
import { type ClickHouseClient } from '@clickhouse/client';
import { DateTime } from 'luxon';
import { type Candle } from '@quantbot/utils';
export interface TickEvent {
    timestamp: number;
    price: number;
    size?: number;
    signature?: string;
    slot?: number;
    source?: 'ws' | 'backfill' | 'rpc';
}
/**
 * Get or create ClickHouse client instance
 */
export declare function getClickHouseClient(): ClickHouseClient;
/**
 * Initialize ClickHouse database and create tables
 */
export declare function initClickHouse(): Promise<void>;
/**
 * Insert candles into ClickHouse
 */
export declare function insertCandles(tokenAddress: string, chain: string, candles: Candle[], interval?: string, isBackfill?: boolean): Promise<void>;
/**
 * Insert raw ticks into ClickHouse for high-resolution replay.
 */
export declare function insertTicks(tokenAddress: string, chain: string, ticks: TickEvent[]): Promise<void>;
/**
 * Query candles from ClickHouse
 */
export declare function queryCandles(tokenAddress: string, chain: string, startTime: DateTime, endTime: DateTime, interval?: string): Promise<Candle[]>;
/**
 * Check if candles exist in ClickHouse for a given token and time range
 */
export declare function hasCandles(tokenAddress: string, chain: string, startTime: DateTime, endTime: DateTime): Promise<boolean>;
/**
 * Close ClickHouse client connection
 */
export declare function closeClickHouse(): Promise<void>;
//# sourceMappingURL=clickhouse-client.d.ts.map