/**
 * @quantbot/api-clients - API Client Package
 *
 * Public API exports for API clients
 */

export * from './base-client.js';
export * from './birdeye-client.js';
export * from './helius-client.js';

// Explicit exports for better TypeScript support
export { BirdeyeClient, getBirdeyeClient } from './birdeye-client.js';
export { HeliusRestClient as HeliusClient } from './helius-client.js';

// Multi-chain metadata service
export {
  fetchMultiChainMetadata,
  batchFetchMultiChainMetadata,
  type TokenMetadata,
  type MultiChainMetadataResult,
} from './multi-chain-metadata-service.js';
export { MultiChainMetadataCache, getMetadataCache } from './multi-chain-metadata-cache.js';

// Birdeye OHLCV fetching (with automatic chunking)
export { fetchBirdeyeCandles, fetchBirdeyeCandlesDirect } from './birdeye-ohlcv.js';
