/**
 * Birdeye API Candle Provider
 * ===========================
 * Fetches candles from Birdeye API.
 * 
 * @deprecated This provider is deprecated. Use @quantbot/ohlcv instead.
 * This file will be removed in Phase 3 when data providers are moved to workflows.
 * 
 * ⚠️ ARCHITECTURAL VIOLATION: This file imports axios (network calls) which violates
 * simulation package rules. This provider should be moved to @quantbot/ohlcv or @quantbot/workflows.
 */
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
  
  async fetchCandles(_request: CandleFetchRequest): Promise<CandleFetchResult> {
    throw new Error(
      'BirdeyeCandleProvider is deprecated and violates architectural rules. ' +
        'It imports axios (network calls) which is forbidden in the simulation package. ' +
        'Use @quantbot/ohlcv providers instead, or move this provider to @quantbot/workflows.'
    );
  }
  
  async canServe(_request: CandleFetchRequest): Promise<boolean> {
    return !!getBirdeyeApiKey();
  }
  
  priority(): number {
    return 100; // API is lowest priority (use cache first)
  }
  
  /**
   * Fetch candles with automatic chunking for large time ranges
   * @deprecated This method uses axios which violates architectural rules
   */
  private async fetchWithChunking(
    _mint: string,
    _interval: '15s' | '1m' | '5m' | '1H',
    _from: number,
    _to: number,
    _chain: string,
    _apiKey: string
  ): Promise<Candle[]> {
    throw new Error(
      'BirdeyeCandleProvider.fetchWithChunking is deprecated and uses axios (forbidden in simulation package). ' +
        'Use @quantbot/ohlcv providers instead.'
    );
  }
  
  /**
   * Fetch a single chunk of candles
   * @deprecated This method uses axios which violates architectural rules
   */
  private async fetchChunk(
    _mint: string,
    _interval: '15s' | '1m' | '5m' | '1H',
    _from: number,
    _to: number,
    _chain: string,
    _apiKey: string
  ): Promise<Candle[]> {
    throw new Error(
      'BirdeyeCandleProvider.fetchChunk is deprecated and uses axios (forbidden in simulation package). ' +
        'Use @quantbot/ohlcv providers instead.'
    );
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
  
  async fetchMetadata(_mint: string, _chain: string = 'solana'): Promise<TokenMetadata | null> {
    throw new Error(
      'BirdeyeMetadataProvider is deprecated and uses axios (forbidden in simulation package). ' +
        'Use @quantbot/ohlcv providers instead.'
    );
  }
}

