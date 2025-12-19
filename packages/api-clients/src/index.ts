/**
 * @quantbot/api-clients - API Client Package
 *
 * Public API exports for API clients
 */

export * from './base-client';
export * from './birdeye-client';
export * from './helius-client';

// Explicit exports for better TypeScript support
export { BirdeyeClient, getBirdeyeClient } from './birdeye-client';
export { HeliusRestClient as HeliusClient } from './helius-client';

// Multi-chain metadata service
export {
  fetchMultiChainMetadata,
  batchFetchMultiChainMetadata,
  type TokenMetadata,
  type MultiChainMetadataResult,
} from './multi-chain-metadata-service';
export { MultiChainMetadataCache, getMetadataCache } from './multi-chain-metadata-cache';

// Birdeye OHLCV fetching (with automatic chunking)
export { fetchBirdeyeCandles, fetchBirdeyeCandlesDirect } from './birdeye-ohlcv';
