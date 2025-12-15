/**
 * Candle Provider Interfaces
 * ==========================
 * Abstract interfaces for candle data sources.
 */

import { DateTime } from 'luxon';
import type { Candle, CandleInterval } from '../types';

/**
 * Token metadata from data providers
 */
export interface TokenMetadata {
  /** Token name */
  name: string;
  /** Token symbol/ticker */
  symbol: string;
  /** Market capitalization */
  marketCap?: number;
  /** Current price */
  price?: number;
  /** Token decimals */
  decimals?: number;
  /** Social media links */
  socials?: {
    twitter?: string;
    telegram?: string;
    discord?: string;
    website?: string;
  };
  /** Creator address */
  creator?: string;
  /** Top wallet holdings percentage */
  topWalletHoldings?: number;
  /** 24h trading volume */
  volume24h?: number;
  /** 24h price change percentage */
  priceChange24h?: number;
  /** Logo URI */
  logoURI?: string;
}

/**
 * Candle fetch request
 */
export interface CandleFetchRequest {
  /** Token mint address */
  mint: string;
  /** Blockchain (default: 'solana') */
  chain?: string;
  /** Start time */
  startTime: DateTime;
  /** End time */
  endTime: DateTime;
  /** Candle interval */
  interval?: CandleInterval;
  /** Alert time (for optimized fetching) */
  alertTime?: DateTime;
}

/**
 * Candle fetch result
 */
export interface CandleFetchResult {
  /** Fetched candles */
  candles: Candle[];
  /** Source of data */
  source: 'api' | 'cache' | 'clickhouse';
  /** Whether data was complete */
  complete: boolean;
  /** Optional token metadata */
  metadata?: TokenMetadata;
}

/**
 * Abstract candle data provider
 */
export interface CandleProvider {
  /** Provider name */
  readonly name: string;
  
  /**
   * Fetch candles for a token
   */
  fetchCandles(request: CandleFetchRequest): Promise<CandleFetchResult>;
  
  /**
   * Check if provider can serve this request
   */
  canServe(request: CandleFetchRequest): Promise<boolean>;
  
  /**
   * Get provider priority (lower = higher priority)
   */
  priority(): number;
}

/**
 * Candle storage provider (for caching)
 */
export interface CandleStorageProvider extends CandleProvider {
  /**
   * Store candles
   */
  storeCandles(
    mint: string,
    chain: string,
    candles: Candle[],
    interval: CandleInterval
  ): Promise<void>;
  
  /**
   * Check if candles exist for a time range
   */
  hasCandles(
    mint: string,
    chain: string,
    startTime: DateTime,
    endTime: DateTime,
    interval: CandleInterval
  ): Promise<boolean>;
  
  /**
   * Delete cached candles
   */
  deleteCandles(
    mint: string,
    chain: string,
    startTime?: DateTime,
    endTime?: DateTime
  ): Promise<void>;
}

/**
 * Metadata provider interface
 */
export interface MetadataProvider {
  /** Provider name */
  readonly name: string;
  
  /**
   * Fetch token metadata
   */
  fetchMetadata(mint: string, chain?: string): Promise<TokenMetadata | null>;
}

/**
 * Provider registry
 */
export class ProviderRegistry {
  private providers: CandleProvider[] = [];
  private metadataProviders: MetadataProvider[] = [];
  
  /**
   * Register a candle provider
   */
  registerCandleProvider(provider: CandleProvider): void {
    this.providers.push(provider);
    this.providers.sort((a, b) => a.priority() - b.priority());
  }
  
  /**
   * Register a metadata provider
   */
  registerMetadataProvider(provider: MetadataProvider): void {
    this.metadataProviders.push(provider);
  }
  
  /**
   * Get all candle providers
   */
  getCandleProviders(): readonly CandleProvider[] {
    return this.providers;
  }
  
  /**
   * Get all metadata providers
   */
  getMetadataProviders(): readonly MetadataProvider[] {
    return this.metadataProviders;
  }
  
  /**
   * Find a provider that can serve a request
   */
  async findProvider(request: CandleFetchRequest): Promise<CandleProvider | null> {
    for (const provider of this.providers) {
      if (await provider.canServe(request)) {
        return provider;
      }
    }
    return null;
  }
}

/**
 * Global provider registry
 */
export const globalProviderRegistry = new ProviderRegistry();

