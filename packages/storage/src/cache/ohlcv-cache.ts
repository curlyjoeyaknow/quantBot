import { LRUCache } from 'lru-cache';
import { logger } from '@quantbot/utils';

/**
 * Candle type for caching OHLCV data.
 * Uses a superset of core Candle to allow optional dateTime for legacy flows.
 */
export interface OhlcvCacheCandle {
  timestamp: number; // milliseconds epoch
  dateTime?: Date; // optional for legacy ingestion flows
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CacheEntry {
  data: OhlcvCacheCandle[];
  timestamp: number;
  ttl: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  hitRate: number;
}

/**
 * LRU cache for OHLCV data with TTL support.
 * Intended for short-term credit conservation before persisting to storage.
 */
export class OHLCVCache {
  private cache: LRUCache<string, CacheEntry>;
  private stats: CacheStats;

  constructor(maxSize: number = 2000) {
    this.cache = new LRUCache<string, CacheEntry>({
      max: maxSize,
      ttl: 1000 * 60 * 30, // 30 minutes default TTL
      updateAgeOnGet: true,
      updateAgeOnHas: true,
    });

    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      hitRate: 0,
    };

    logger.info('OHLCV Cache initialized', { maxSize, ttl: '30min' });
  }

  private generateCacheKey(
    tokenAddress: string,
    startTime: Date,
    endTime: Date,
    interval: string = '1m',
  ): string {
    const startUnix = Math.floor(startTime.getTime() / 1000);
    const endUnix = Math.floor(endTime.getTime() / 1000);
    return `${tokenAddress.toLowerCase()}:${startUnix}:${endUnix}:${interval}`;
  }

  get(
    tokenAddress: string,
    startTime: Date,
    endTime: Date,
    interval: string = '1m',
  ): OhlcvCacheCandle[] | null {
    const key = this.generateCacheKey(tokenAddress, startTime, endTime, interval);
    const entry = this.cache.get(key);

    if (entry) {
      const now = Date.now();
      if (now - entry.timestamp < entry.ttl) {
        this.stats.hits++;
        this.updateHitRate();
        logger.debug('Cache HIT', {
          tokenAddress,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
        });
        return entry.data;
      }

      this.cache.delete(key);
      this.stats.deletes++;
    }

    this.stats.misses++;
    this.updateHitRate();
    logger.debug('Cache MISS', {
      tokenAddress,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    });
    return null;
  }

  set(
    tokenAddress: string,
    startTime: Date,
    endTime: Date,
    data: OhlcvCacheCandle[],
    interval: string = '1m',
    ttlMinutes: number = 5,
  ): void {
    const key = this.generateCacheKey(tokenAddress, startTime, endTime, interval);
    const ttl = ttlMinutes * 60 * 1000;

    const entry: CacheEntry = {
      data,
      timestamp: Date.now(),
      ttl,
    };

    this.cache.set(key, entry);
    this.stats.sets++;

    logger.debug('Cache SET', { tokenAddress, recordCount: data.length, ttlMinutes });
  }

  has(
    tokenAddress: string,
    startTime: Date,
    endTime: Date,
    interval: string = '1m',
  ): boolean {
    const key = this.generateCacheKey(tokenAddress, startTime, endTime, interval);
    return this.cache.has(key);
  }

  delete(
    tokenAddress: string,
    startTime: Date,
    endTime: Date,
    interval: string = '1m',
  ): boolean {
    const key = this.generateCacheKey(tokenAddress, startTime, endTime, interval);
    const deleted = this.cache.delete(key);

    if (deleted) {
      this.stats.deletes++;
      logger.debug('Cache DELETE', { tokenAddress });
    }

    return deleted;
  }

  clear(): void {
    this.cache.clear();
    logger.info('Cache cleared');
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;
  }

  getCacheInfo(): { size: number; maxSize: number; utilization: number } {
    const size = this.cache.size;
    const maxSize = this.cache.max;
    const utilization = (size / maxSize) * 100;

    return {
      size,
      maxSize,
      utilization,
    };
  }

  async prefetchForSimulation(
    tokens: string[],
    startTime: Date,
    endTime: Date,
    fetchFunction: (token: string, start: Date, end: Date) => Promise<OhlcvCacheCandle[] | null>,
  ): Promise<Map<string, OhlcvCacheCandle[]>> {
    logger.info('Pre-fetching OHLCV data', { tokenCount: tokens.length });

    const results = new Map<string, OhlcvCacheCandle[]>();
    const promises = tokens.map(async (token) => {
      try {
        const cachedData = this.get(token, startTime, endTime);
        if (cachedData) {
          results.set(token, cachedData);
          return;
        }

        const data = await fetchFunction(token, startTime, endTime);
        if (data && data.length > 0) {
          this.set(token, startTime, endTime, data, '1m', 60); // 1 hour TTL
          results.set(token, data);
        }
      } catch (error) {
        logger.error('Failed to pre-fetch data', error as Error, { token });
      }
    });

    await Promise.all(promises);

    logger.info('Pre-fetch complete', { cachedCount: results.size, totalCount: tokens.length });
    return results;
  }

  logStats(): void {
    const stats = this.getStats();
    const info = this.getCacheInfo();

    logger.info('OHLCV Cache Statistics', {
      hits: stats.hits,
      misses: stats.misses,
      sets: stats.sets,
      deletes: stats.deletes,
      hitRate: stats.hitRate.toFixed(2),
      cacheSize: info.size,
      maxSize: info.maxSize,
      utilization: info.utilization.toFixed(1),
    });
  }
}

export const ohlcvCache = new OHLCVCache();

