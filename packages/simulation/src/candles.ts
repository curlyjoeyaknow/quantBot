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
 * @deprecated Import from '@quantbot/ohlcv' instead.
 * This function has been moved to @quantbot/ohlcv to break circular dependencies.
 *
 * @example
 * ```typescript
 * // Old (deprecated):
 * import { fetchHybridCandles } from '@quantbot/simulation';
 *
 * // New (recommended):
 * import { fetchHybridCandles } from '@quantbot/ohlcv';
 * ```
 */
// eslint-disable-next-line no-restricted-imports
export { fetchHybridCandles } from '@quantbot/ohlcv';

/**
 * Fetch candles with token metadata.
 *
 * @deprecated Import from '@quantbot/ohlcv' instead.
 *
 * @example
 * ```typescript
 * // Old (deprecated):
 * import { fetchHybridCandlesWithMetadata } from '@quantbot/simulation';
 *
 * // New (recommended):
 * import { fetchHybridCandlesWithMetadata } from '@quantbot/ohlcv';
 * ```
 */
// eslint-disable-next-line no-restricted-imports
export { fetchHybridCandlesWithMetadata } from '@quantbot/ohlcv';

/**
 * Fetch candles directly from Birdeye API (bypasses cache).
 *
 * @deprecated Import from '@quantbot/ohlcv' instead.
 */
// eslint-disable-next-line no-restricted-imports
export { fetchBirdeyeCandlesDirect } from '@quantbot/ohlcv';

/**
 * Fetch optimized candles for alert (multi-timeframe strategy).
 *
 * @deprecated Import from '@quantbot/ohlcv' instead.
 */
// eslint-disable-next-line no-restricted-imports
export { fetchOptimizedCandlesForAlert } from '@quantbot/ohlcv';
