/**
 * Birdeye API Candle Provider
 * ===========================
 * Fetches candles from Birdeye API.
 * 
 * @deprecated This provider is deprecated. Use @quantbot/ohlcv instead.
 * This file will be removed in Phase 3 when data providers are moved to workflows.
 */

// eslint-disable-next-line no-restricted-imports
import axios from 'axios';
import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import type { Candle, CandleInterval } from '../types';
import type { 
  CandleProvider, 
  CandleFetchRequest, 
  CandleFetchResult,
  MetadataProvider,
  TokenMetadata 
} from './provider';

const BIRDEYE_ENDPOINT = 'https://public-api.birdeye.so/defi/v3/ohlcv';
const MAX_CANDLES_PER_REQUEST = 5000;

/**
 * Get Birdeye API key from environment
 */
function getBirdeyeApiKey(): string {
  return process.env.BIRDEYE_API_KEY_1 || process.env.BIRDEYE_API_KEY || '';
}

/**
 * Get interval seconds
 */
function getIntervalSeconds(interval: CandleInterval): number {
  const intervals: Record<string, number> = {
    '15s': 15,
    '1m': 60,
    '5m': 300,
    '15m': 900,
    '1H': 3600,
    '4H': 14400,
    '1D': 86400,
  };
  return intervals[interval] || 300;
}

/**
 * Birdeye candle data provider
 */
export class BirdeyeCandleProvider implements CandleProvider {
  readonly name = 'birdeye';
  
  async fetchCandles(request: CandleFetchRequest): Promise<CandleFetchResult> {
    const apiKey = getBirdeyeApiKey();
    if (!apiKey) {
      throw new Error('BIRDEYE_API_KEY is not set');
    }
    
    const interval = request.interval || '5m';
    const chain = request.chain || 'solana';
    const from = Math.floor(request.startTime.toSeconds());
    const to = Math.floor(request.endTime.toSeconds());
    
    const candles = await this.fetchWithChunking(
      request.mint,
      interval as '15s' | '1m' | '5m' | '1H',
      from,
      to,
      chain,
      apiKey
    );
    
    return {
      candles,
      source: 'api',
      complete: candles.length > 0,
    };
  }
  
  async canServe(_request: CandleFetchRequest): Promise<boolean> {
    return !!getBirdeyeApiKey();
  }
  
  priority(): number {
    return 100; // API is lowest priority (use cache first)
  }
  
  /**
   * Fetch candles with automatic chunking for large time ranges
   */
  private async fetchWithChunking(
    mint: string,
    interval: '15s' | '1m' | '5m' | '1H',
    from: number,
    to: number,
    chain: string,
    apiKey: string
  ): Promise<Candle[]> {
    const intervalSeconds = getIntervalSeconds(interval);
    const maxWindowSeconds = MAX_CANDLES_PER_REQUEST * intervalSeconds;
    const durationSeconds = to - from;
    const estimatedCandles = Math.ceil(durationSeconds / intervalSeconds);
    
    // If we need more than 5000 candles, chunk the requests
    if (estimatedCandles > MAX_CANDLES_PER_REQUEST) {
      logger.debug(`Chunking request for ${mint.substring(0, 20)}... (${estimatedCandles} candles estimated)`);
      
      const allCandles: Candle[] = [];
      let currentFrom = from;
      
      while (currentFrom < to) {
        const chunkTo = Math.min(currentFrom + maxWindowSeconds, to);
        const chunkCandles = await this.fetchChunk(mint, interval, currentFrom, chunkTo, chain, apiKey);
        
        if (chunkCandles.length === 0) break;
        
        allCandles.push(...chunkCandles);
        
        const lastTimestamp = chunkCandles[chunkCandles.length - 1]?.timestamp;
        currentFrom = lastTimestamp ? lastTimestamp + intervalSeconds : chunkTo;
        
        if (currentFrom < to) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      return this.deduplicateAndSort(allCandles);
    }
    
    return this.fetchChunk(mint, interval, from, to, chain, apiKey);
  }
  
  /**
   * Fetch a single chunk of candles
   */
  private async fetchChunk(
    mint: string,
    interval: '15s' | '1m' | '5m' | '1H',
    from: number,
    to: number,
    chain: string,
    apiKey: string
  ): Promise<Candle[]> {
    try {
      const response = await axios.get(BIRDEYE_ENDPOINT, {
        headers: {
          'X-API-KEY': apiKey,
          'x-chain': chain,
          accept: 'application/json',
        },
        params: {
          address: mint,
          type: interval,
          currency: 'usd',
          ui_amount_mode: 'raw',
          time_from: from,
          time_to: to,
          mode: 'range',
          padding: true,
          outlier: true,
        },
        validateStatus: (status) => status < 500,
      });
      
      if (response.status === 400 || response.status === 404) {
        return [];
      }
      
      if (response.status !== 200) {
        throw new Error(`Birdeye API returned status ${response.status}`);
      }
      
      const items: any[] = response.data?.data?.items ?? [];
      return items.map(item => ({
        timestamp: item.unix_time,
        open: parseFloat(item.o) || NaN,
        high: parseFloat(item.h) || NaN,
        low: parseFloat(item.l) || NaN,
        close: parseFloat(item.c) || NaN,
        volume: parseFloat(item.v) || NaN,
      }));
    } catch (error: any) {
      if (error.response?.status === 400 || error.response?.status === 404) {
        return [];
      }
      throw error;
    }
  }
  
  /**
   * Deduplicate and sort candles
   */
  private deduplicateAndSort(candles: Candle[]): Candle[] {
    const unique = new Map<number, Candle>();
    for (const candle of candles) {
      if (!unique.has(candle.timestamp)) {
        unique.set(candle.timestamp, candle);
      }
    }
    return Array.from(unique.values()).sort((a, b) => a.timestamp - b.timestamp);
  }
}

/**
 * Birdeye metadata provider
 */
export class BirdeyeMetadataProvider implements MetadataProvider {
  readonly name = 'birdeye';
  
  async fetchMetadata(mint: string, chain: string = 'solana'): Promise<TokenMetadata | null> {
    const apiKey = getBirdeyeApiKey();
    if (!apiKey) {
      return null;
    }
    
    const headers = {
      'X-API-KEY': apiKey,
      accept: 'application/json',
      'x-chain': chain,
    };
    
    // Try token overview endpoint first
    try {
      const response = await axios.get(
        'https://public-api.birdeye.so/defi/token_overview',
        {
          headers,
          params: { address: mint },
          timeout: 10000,
          validateStatus: (status) => status < 500,
        }
      );
      
      if (response.status === 200 && response.data?.success && response.data?.data) {
        const data = response.data.data;
        return {
          name: data.name || `Token ${mint.substring(0, 8)}`,
          symbol: data.symbol || mint.substring(0, 4).toUpperCase(),
          marketCap: data.marketCap || data.mc || data.marketCapUsd,
          price: data.price || data.priceUsd,
          decimals: data.decimals,
          volume24h: data.volume24h || data.volume24hUsd,
          priceChange24h: data.priceChange24h,
          logoURI: data.logoURI || data.logo,
          socials: data.socials ? {
            twitter: data.socials.twitter,
            telegram: data.socials.telegram,
            discord: data.socials.discord,
            website: data.socials.website || data.website,
          } : undefined,
          creator: data.creator || data.creatorAddress,
          topWalletHoldings: data.topWalletHoldings || data.top10Holdings,
        };
      }
    } catch (error: any) {
      logger.debug('Token overview endpoint failed', { mint: mint.substring(0, 20), error: error.message });
    }
    
    // Fallback to metadata endpoint
    try {
      const response = await axios.get(
        'https://public-api.birdeye.so/defi/v3/token/meta-data/single',
        {
          headers,
          params: { address: mint },
          timeout: 10000,
          validateStatus: (status) => status < 500,
        }
      );
      
      if (response.status === 200 && response.data?.success && response.data?.data) {
        const data = response.data.data;
        return {
          name: data.name || `Token ${mint.substring(0, 8)}`,
          symbol: data.symbol || mint.substring(0, 4).toUpperCase(),
          marketCap: data.marketCap || data.mc,
          price: data.price,
          decimals: data.decimals,
          volume24h: data.volume24h,
          priceChange24h: data.priceChange24h,
          logoURI: data.logoURI || data.logo,
          socials: data.socials ? {
            twitter: data.socials.twitter,
            telegram: data.socials.telegram,
            discord: data.socials.discord,
            website: data.socials.website || data.website,
          } : undefined,
          creator: data.creator || data.creatorAddress,
          topWalletHoldings: data.topWalletHoldings || data.top10Holdings,
        };
      }
    } catch (error: any) {
      logger.debug('Metadata endpoint failed', { mint: mint.substring(0, 20), error: error.message });
    }
    
    return null;
  }
}

