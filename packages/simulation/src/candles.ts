/*******************************************************************************
 * Candle Utilities - Deprecated Re-export Shim
 *
 * ⚠️ DEPRECATED: This file is a temporary shim for backwards compatibility.
 * All I/O operations (fetching, caching, database) have been moved to
 * @quantbot/ohlcv. Pure math functions (aggregation, slicing) remain in
 * @quantbot/simulation/data/aggregator.
 *
 * Migration path:
 * - Types: Import from @quantbot/core or ./types
 * - Fetch functions: Import from @quantbot/ohlcv
 * - Aggregation: Import from ./data/aggregator
 *
 * This shim will be removed in a future version.
 ******************************************************************************/

// ============================================================================
// Type Re-exports
// ============================================================================

/**
 * @deprecated Import from './types' or '@quantbot/core' instead
 */
export type { Candle, AggregationInterval } from './types';

/**
 * @deprecated Import from '@quantbot/core' instead
 */
export type { TokenMetadata } from '@quantbot/core';

// ============================================================================
// Pure Math Re-exports (from data/aggregator)
// ============================================================================

/**
 * Aggregate lower-timeframe candles into higher-timeframe candles.
 *
 * @deprecated Import from './data/aggregator' instead
 */
export { aggregateCandles } from './data/aggregator';

// ============================================================================
// I/O Function Re-exports (from @quantbot/ohlcv) - DEPRECATED
// ============================================================================

/**
 * Fetch candles using hybrid provider (Birdeye API + ClickHouse cache).
 *
 * @deprecated This function has been moved to the @quantbot/ohlcv package.
 * This stub throws an error to enforce migration.
 */
export async function fetchHybridCandles(..._args: unknown[]): Promise<never> {
  throw new Error('fetchHybridCandles has been moved. Import from @quantbot/ohlcv instead.');
}

/**
 * Fetch candles with token metadata.
 *
 * @deprecated This function has been moved to the @quantbot/ohlcv package.
 * This stub throws an error to enforce migration.
 */
export async function fetchHybridCandlesWithMetadata(..._args: unknown[]): Promise<never> {
  throw new Error(
    'fetchHybridCandlesWithMetadata has been moved. Import from @quantbot/ohlcv instead.'
  );
}

/**
 * Fetch candles directly from Birdeye API (bypasses cache).
 *
 * @deprecated This function has been moved to the @quantbot/ohlcv package.
 * This stub throws an error to enforce migration.
 */
export async function fetchBirdeyeCandlesDirect(..._args: unknown[]): Promise<never> {
  throw new Error('fetchBirdeyeCandlesDirect has been moved. Import from @quantbot/ohlcv instead.');
}

/**
 * Fetch optimized candles for alert (multi-timeframe strategy).
 *
 * @deprecated This function has been moved to the @quantbot/ohlcv package.
 * This stub throws an error to enforce migration.
 */
export async function fetchOptimizedCandlesForAlert(..._args: unknown[]): Promise<never> {
  throw new Error(
    'fetchOptimizedCandlesForAlert has been moved. Import from @quantbot/ohlcv instead.'
  );
}
