/**
 * ClickHouse Provider
 * ===================
 * ClickHouse-based candle storage and retrieval.
 * 
 * @deprecated This provider is deprecated. Use @quantbot/ohlcv instead.
 * This file will be removed in a future version.
 */

import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import type { Candle, CandleInterval } from '../types';
import type { 
  CandleStorageProvider, 
  CandleFetchRequest, 
  CandleFetchResult 
} from './provider';

/**
 * Check if ClickHouse is available
 */
function isClickHouseEnabled(): boolean {
  return process.env.USE_CLICKHOUSE === 'true' || !!process.env.CLICKHOUSE_HOST;
}

/**
 * ClickHouse candle provider
 */
export class ClickHouseProvider implements CandleStorageProvider {
  readonly name = 'clickhouse';
  private initialized = false;
  
  async fetchCandles(request: CandleFetchRequest): Promise<CandleFetchResult> {
    if (!isClickHouseEnabled()) {
      return { candles: [], source: 'clickhouse', complete: false };
    }
    
    try {
      // Dynamic import to avoid circular dependencies
      const { queryCandles } = await import('@quantbot/storage/clickhouse-client');
      const candles = await queryCandles(
        request.mint,
        request.chain || 'solana',
        request.startTime,
        request.endTime
      );
      
      return {
        candles: candles as Candle[],
        source: 'clickhouse',
        complete: candles.length > 0,
      };
    } catch (error: any) {
      logger.warn('ClickHouse query failed', { 
        mint: request.mint.substring(0, 20), 
        error: error.message 
      });
      return { candles: [], source: 'clickhouse', complete: false };
    }
  }
  
  async canServe(request: CandleFetchRequest): Promise<boolean> {
    if (!isClickHouseEnabled()) return false;
    
    try {
      const result = await this.fetchCandles(request);
      return result.candles.length > 0;
    } catch {
      return false;
    }
  }
  
  priority(): number {
    return 5; // ClickHouse has highest priority (fastest queries)
  }
  
  async storeCandles(
    mint: string,
    chain: string,
    candles: Candle[],
    interval: CandleInterval
  ): Promise<void> {
    if (!isClickHouseEnabled() || candles.length === 0) return;
    
    try {
      const { insertCandles } = await import('@quantbot/storage/clickhouse-client');
      await insertCandles(mint, chain, candles as any, interval);
      logger.debug(`Saved ${candles.length} candles to ClickHouse for ${mint.substring(0, 20)}...`);
    } catch (error: any) {
      logger.error('Failed to save to ClickHouse', error as Error, { 
        mint: mint.substring(0, 20) 
      });
    }
  }
  
  async hasCandles(
    mint: string,
    chain: string,
    startTime: DateTime,
    endTime: DateTime,
    _interval: CandleInterval
  ): Promise<boolean> {
    if (!isClickHouseEnabled()) return false;
    
    try {
      const { queryCandles } = await import('@quantbot/storage/clickhouse-client');
      const candles = await queryCandles(mint, chain, startTime, endTime);
      return candles.length > 0;
    } catch {
      return false;
    }
  }
  
  async deleteCandles(
    _mint: string,
    _chain: string,
    _startTime?: DateTime,
    _endTime?: DateTime
  ): Promise<void> {
    // ClickHouse delete is complex, skip for now
    logger.warn('ClickHouse delete not implemented');
  }
}

