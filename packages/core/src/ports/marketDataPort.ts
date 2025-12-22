/**
 * Market Data Port
 *
 * Port interface for market data providers (Birdeye, Helius, Shyft, etc.).
 * Adapters implement this port to provide market data capabilities.
 */

import type { Candle, TokenAddress, Chain } from '../index.js';

/**
 * OHLCV data request
 */
export type MarketDataOhlcvRequest = {
  tokenAddress: TokenAddress;
  chain: Chain;
  interval: '15s' | '1m' | '5m' | '15m' | '1H' | '4H' | '1D';
  from: number; // UNIX timestamp (seconds)
  to: number; // UNIX timestamp (seconds)
};

/**
 * Token metadata request
 */
export type MarketDataMetadataRequest = {
  tokenAddress: TokenAddress;
  chain?: Chain; // Optional chain hint for multi-chain lookups
};

/**
 * Token metadata response
 */
export type TokenMetadata = {
  address: string;
  chain: Chain;
  name?: string;
  symbol?: string;
  decimals?: number;
  price?: number;
  logoURI?: string;
  priceChange24h?: number;
  volume24h?: number;
  marketCap?: number;
};

/**
 * Historical price at specific time
 */
export type HistoricalPriceRequest = {
  tokenAddress: TokenAddress;
  unixTime: number; // UNIX timestamp (seconds)
  chain?: Chain;
};

export type HistoricalPriceResponse = {
  unixTime: number;
  value: number;
  price?: number;
} | null;

/**
 * Market Data Port Interface
 *
 * Handlers depend on this port, not on specific implementations (BirdeyeClient, HeliusClient, etc.).
 * Adapters (in packages/api-clients) implement this port.
 */
export interface MarketDataPort {
  /**
   * Fetch OHLCV candles for a token
   */
  fetchOhlcv(request: MarketDataOhlcvRequest): Promise<Candle[]>;

  /**
   * Fetch token metadata
   */
  fetchMetadata(request: MarketDataMetadataRequest): Promise<TokenMetadata | null>;

  /**
   * Fetch historical price at a specific unix time
   */
  fetchHistoricalPriceAtTime(request: HistoricalPriceRequest): Promise<HistoricalPriceResponse>;
}
