/**
 * Birdeye Data Provider
 * 
 * This module provides data-fetching functions for Birdeye API.
 * 
 * NOTE: Currently re-exports from @quantbot/simulation for backward compatibility.
 * The actual functions will be migrated here incrementally.
 */

// Re-export candle fetching functions from simulation (will be migrated here)
export {
  fetchHybridCandles,
  fetchHybridCandlesWithMetadata,
  fetchBirdeyeCandlesDirect,
  fetchOptimizedCandlesForAlert,
  fetchTokenMetadata,
  aggregateCandles,
} from '@quantbot/simulation/candles';

export type {
  TokenMetadata,
  AggregationInterval,
} from '@quantbot/simulation/candles';

// Export BirdeyeClient (moved from @quantbot/services/api)
export { BirdeyeClient } from './birdeye-client';
export type { BirdeyeOHLCVResponse, APIKeyUsage } from './birdeye-client';

