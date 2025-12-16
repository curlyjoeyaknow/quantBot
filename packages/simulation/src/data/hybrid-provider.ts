/**
 * Hybrid Candle Provider
 * ======================
 * Combines multiple data sources with fallback logic.
 * 
 * @deprecated This provider is deprecated. Use @quantbot/ohlcv instead.
 * This file will be removed in Phase 3 when data providers are moved to workflows.
 */

import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import type { Candle, CandleInterval } from '../types';
import { logStep, logOperationStart, logOperationComplete } from '../utils/progress';
import type { 
  CandleProvider, 
  CandleFetchRequest, 
  CandleFetchResult,
  CandleStorageProvider,
  TokenMetadata,
  MetadataProvider 
} from './provider';
import { BirdeyeCandleProvider, BirdeyeMetadataProvider } from './birdeye-provider';
import { CsvCacheProvider } from './cache-provider';
import { ClickHouseProvider } from './clickhouse-provider';

/**
 * Ichimoku lookback requirements
 */
const ICHIMOKU_LOOKBACK_PERIODS = 52;
const FIVE_MINUTE_SECONDS = 5 * 60;
const ONE_MINUTE_SECONDS = 60;
const ICHIMOKU_5M_LOOKBACK_SECONDS = ICHIMOKU_LOOKBACK_PERIODS * FIVE_MINUTE_SECONDS; // 260 minutes

/**
 * Hybrid provider options
 */
export interface HybridProviderOptions {
  /** Enable ClickHouse storage */
  enableClickHouse?: boolean;
  /** Enable CSV cache */
  enableCsvCache?: boolean;
  /** Cache directory for CSV files */
  cacheDir?: string;
  /** Cache expiry in hours */
  cacheExpiryHours?: number;
  /** Fetch 1m candles around alert time */
  fetchOneMinuteCandles?: boolean;
  /** Minutes of 1m candles before alert */
  oneMinuteWindowBefore?: number;
  /** Minutes of 1m candles after alert */
  oneMinuteWindowAfter?: number;
}

/**
 * Hybrid candle provider that combines multiple sources
 */
export class HybridCandleProvider implements CandleProvider {
  readonly name = 'hybrid';
  
  private readonly providers: CandleStorageProvider[];
  private readonly apiProvider: CandleProvider;
  private readonly metadataProvider: MetadataProvider;
  private readonly options: Required<HybridProviderOptions>;
  
  constructor(options: HybridProviderOptions = {}) {
    this.options = {
      enableClickHouse: options.enableClickHouse ?? true,
      enableCsvCache: options.enableCsvCache ?? true,
      cacheDir: options.cacheDir ?? undefined as any,
      cacheExpiryHours: options.cacheExpiryHours ?? 24,
      fetchOneMinuteCandles: options.fetchOneMinuteCandles ?? true,
      oneMinuteWindowBefore: options.oneMinuteWindowBefore ?? 52, // For Ichimoku
      oneMinuteWindowAfter: options.oneMinuteWindowAfter ?? 4948, // Fill to 5000 candles
    };
    
    this.providers = [];
    
    if (this.options.enableClickHouse) {
      this.providers.push(new ClickHouseProvider());
    }
    
    if (this.options.enableCsvCache) {
      this.providers.push(new CsvCacheProvider({
        cacheDir: this.options.cacheDir,
        expiryHours: this.options.cacheExpiryHours,
      }));
    }
    
    this.apiProvider = new BirdeyeCandleProvider();
    this.metadataProvider = new BirdeyeMetadataProvider();
  }
  
  async fetchCandles(request: CandleFetchRequest): Promise<CandleFetchResult> {
    const chain = request.chain || 'solana';
    
    // Extend start time back for Ichimoku lookback if alertTime is provided
    let actualStartTime = request.startTime;
    if (request.alertTime) {
      const ichimokuLookback = request.alertTime.minus({ seconds: ICHIMOKU_5M_LOOKBACK_SECONDS });
      if (ichimokuLookback < request.startTime) {
        actualStartTime = ichimokuLookback;
        logger.debug(
          `Extended start time back by 260 minutes for Ichimoku: ${actualStartTime.toISO()}`
        );
      }
    }
    
    // Try storage providers first (ClickHouse, then CSV cache)
    for (const provider of this.providers) {
      try {
        const result = await provider.fetchCandles({
          ...request,
          startTime: actualStartTime,
        });
        
        if (result.complete && result.candles.length > 0) {
          logger.debug(`Using ${provider.name} for ${request.mint.substring(0, 20)}...`);
          
          // If alertTime is provided, also fetch 1m candles
          if (request.alertTime && this.options.fetchOneMinuteCandles) {
            const merged = await this.mergeWithOneMinuteCandles(
              result.candles,
              request,
              chain
            );
            return { ...result, candles: merged };
          }
          
          return result;
        }
      } catch (error: any) {
        logger.warn(`${provider.name} fetch failed`, { error: error.message });
      }
    }
    
    // Fall back to API if USE_CACHE_ONLY is not set
    if (process.env.USE_CACHE_ONLY === 'true') {
      logger.debug(`No cached candles for ${request.mint.substring(0, 20)}... (USE_CACHE_ONLY=true)`);
      return { candles: [], source: 'cache', complete: false };
    }
    
    // Fetch from API
    const mintShort = request.mint.substring(0, 20) + '...';
    logStep(`Fetching candles from API`, {
      mint: mintShort,
      interval: '5m',
      startTime: actualStartTime.toISO(),
      endTime: request.endTime.toISO(),
    });
    
    const fetchStart = Date.now();
    const apiResult = await this.apiProvider.fetchCandles({
      ...request,
      startTime: actualStartTime,
      interval: '5m',
    });
    const fetchDuration = Date.now() - fetchStart;
    
    logStep(`Fetched ${apiResult.candles.length} candles`, {
      duration: `${(fetchDuration / 1000).toFixed(2)}s`,
      source: 'api',
    });
    
    if (apiResult.candles.length > 0) {
      // Store in all storage providers
      logStep('Storing candles in cache');
      await this.storeInProviders(request.mint, chain, apiResult.candles, '5m');
      
      // Fetch and merge 1m candles if alertTime is provided
      if (request.alertTime && this.options.fetchOneMinuteCandles) {
        logStep('Fetching 1m candles for high-resolution data');
        apiResult.candles = await this.mergeWithOneMinuteCandles(
          apiResult.candles,
          request,
          chain
        );
        logStep(`Merged to ${apiResult.candles.length} total candles`);
      }
    }
    
    return apiResult;
  }
  
  async canServe(_request: CandleFetchRequest): Promise<boolean> {
    return true; // Hybrid provider can always try
  }
  
  priority(): number {
    return 0; // Hybrid is the default
  }
  
  /**
   * Fetch token metadata
   */
  async fetchMetadata(mint: string, chain: string = 'solana'): Promise<TokenMetadata | null> {
    return this.metadataProvider.fetchMetadata(mint, chain);
  }
  
  /**
   * Fetch candles with metadata
   */
  async fetchCandlesWithMetadata(request: CandleFetchRequest): Promise<{
    candles: Candle[];
    metadata: TokenMetadata | null;
  }> {
    const [result, metadata] = await Promise.all([
      this.fetchCandles(request),
      this.fetchMetadata(request.mint, request.chain || 'solana'),
    ]);
    
    return {
      candles: result.candles,
      metadata,
    };
  }
  
  /**
   * Merge 5m candles with 1m candles around alert time
   */
  private async mergeWithOneMinuteCandles(
    candles5m: Candle[],
    request: CandleFetchRequest,
    chain: string
  ): Promise<Candle[]> {
    if (!request.alertTime) return candles5m;
    
    const alertUnix = Math.floor(request.alertTime.toSeconds());
    const oneMStart = alertUnix - (this.options.oneMinuteWindowBefore * ONE_MINUTE_SECONDS);
    const oneMEnd = oneMStart + ((this.options.oneMinuteWindowBefore + this.options.oneMinuteWindowAfter) * ONE_MINUTE_SECONDS);
    const oneMEndCapped = Math.min(oneMEnd, Math.floor(request.endTime.toSeconds()));
    
    logger.debug(`Fetching 1m candles: ${new Date(oneMStart * 1000).toISOString()} to ${new Date(oneMEndCapped * 1000).toISOString()}`);
    
    const oneMResult = await this.apiProvider.fetchCandles({
      mint: request.mint,
      chain,
      startTime: DateTime.fromSeconds(oneMStart),
      endTime: DateTime.fromSeconds(oneMEndCapped),
      interval: '1m',
    });
    
    if (oneMResult.candles.length === 0) {
      return candles5m;
    }
    
    // Store 1m candles
    await this.storeInProviders(request.mint, chain, oneMResult.candles, '1m');
    
    // Merge: remove 5m candles that overlap with 1m window
    const filtered5m = candles5m.filter(c => {
      const candleEnd = c.timestamp + FIVE_MINUTE_SECONDS;
      return !(c.timestamp < oneMEndCapped && candleEnd > oneMStart);
    });
    
    const merged = [...filtered5m, ...oneMResult.candles].sort((a, b) => a.timestamp - b.timestamp);
    
    logger.debug(
      `Merged: ${candles5m.length} 5m + ${oneMResult.candles.length} 1m = ${merged.length} total`
    );
    
    return merged;
  }
  
  /**
   * Store candles in all storage providers
   */
  private async storeInProviders(
    mint: string,
    chain: string,
    candles: Candle[],
    interval: CandleInterval
  ): Promise<void> {
    await Promise.all(
      this.providers.map(provider =>
        provider.storeCandles(mint, chain, candles, interval).catch(error => {
          logger.warn(`Failed to store in ${provider.name}`, { error: error.message });
        })
      )
    );
  }
}

/**
 * Create a hybrid candle provider with default settings
 */
export function createHybridProvider(options?: HybridProviderOptions): HybridCandleProvider {
  return new HybridCandleProvider(options);
}

