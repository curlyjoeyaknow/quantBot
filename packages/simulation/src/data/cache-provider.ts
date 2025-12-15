/**
 * CSV Cache Provider
 * ==================
 * Local file-based candle caching.
 * 
 * @deprecated This provider is deprecated. Use @quantbot/ohlcv instead.
 * This file will be removed in a future version.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import type { Candle, CandleInterval } from '../types';
import type { 
  CandleStorageProvider, 
  CandleFetchRequest, 
  CandleFetchResult 
} from './provider';

const DEFAULT_CACHE_DIR = path.join(process.cwd(), 'cache');
const CACHE_EXPIRY_HOURS = 24;

/**
 * CSV file-based cache provider
 */
export class CsvCacheProvider implements CandleStorageProvider {
  readonly name = 'csv-cache';
  private readonly cacheDir: string;
  private readonly expiryHours: number;
  
  constructor(options?: { cacheDir?: string; expiryHours?: number }) {
    this.cacheDir = options?.cacheDir || DEFAULT_CACHE_DIR;
    this.expiryHours = options?.expiryHours || CACHE_EXPIRY_HOURS;
    this.ensureCacheDir();
  }
  
  async fetchCandles(request: CandleFetchRequest): Promise<CandleFetchResult> {
    const filename = this.getCacheFilename(
      request.mint,
      request.startTime,
      request.endTime,
      request.chain || 'solana'
    );
    
    const candles = this.loadFromCache(filename);
    if (candles) {
      return {
        candles,
        source: 'cache',
        complete: true,
      };
    }
    
    // Try to find partial cache
    const partialCandles = this.findPartialCache(request);
    if (partialCandles) {
      return {
        candles: partialCandles,
        source: 'cache',
        complete: false,
      };
    }
    
    return {
      candles: [],
      source: 'cache',
      complete: false,
    };
  }
  
  async canServe(request: CandleFetchRequest): Promise<boolean> {
    const filename = this.getCacheFilename(
      request.mint,
      request.startTime,
      request.endTime,
      request.chain || 'solana'
    );
    
    return this.loadFromCache(filename) !== null;
  }
  
  priority(): number {
    return 10; // Cache has high priority
  }
  
  async storeCandles(
    mint: string,
    chain: string,
    candles: Candle[],
    interval: CandleInterval
  ): Promise<void> {
    if (candles.length === 0) return;
    
    const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
    const startTime = DateTime.fromSeconds(sorted[0].timestamp);
    const endTime = DateTime.fromSeconds(sorted[sorted.length - 1].timestamp);
    const filename = this.getCacheFilename(mint, startTime, endTime, chain);
    
    this.saveToCache(candles, filename);
  }
  
  async hasCandles(
    mint: string,
    chain: string,
    startTime: DateTime,
    endTime: DateTime,
    _interval: CandleInterval
  ): Promise<boolean> {
    const filename = this.getCacheFilename(mint, startTime, endTime, chain);
    return this.loadFromCache(filename) !== null;
  }
  
  async deleteCandles(
    mint: string,
    chain: string,
    _startTime?: DateTime,
    _endTime?: DateTime
  ): Promise<void> {
    const pattern = `${chain}_${mint}_`;
    const files = fs.readdirSync(this.cacheDir).filter(f => f.startsWith(pattern));
    
    for (const file of files) {
      try {
        fs.unlinkSync(path.join(this.cacheDir, file));
      } catch (error) {
        logger.warn('Failed to delete cache file', { file });
      }
    }
  }
  
  /**
   * Ensure cache directory exists
   */
  private ensureCacheDir(): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }
  
  /**
   * Generate cache filename
   */
  private getCacheFilename(
    mint: string,
    startTime: DateTime,
    endTime: DateTime,
    chain: string
  ): string {
    const start = startTime.toFormat('yyyyMMdd-HHmm');
    const end = endTime.toFormat('yyyyMMdd-HHmm');
    return `${chain}_${mint}_${start}_${end}.csv`;
  }
  
  /**
   * Save candles to cache
   */
  private saveToCache(candles: Candle[], filename: string): void {
    try {
      const csvContent = [
        'timestamp,open,high,low,close,volume',
        ...candles.map(c =>
          `${c.timestamp},${c.open},${c.high},${c.low},${c.close},${c.volume}`
        ),
      ].join('\n');
      
      fs.writeFileSync(path.join(this.cacheDir, filename), csvContent);
      logger.debug('Cached candles', { count: candles.length, filename });
    } catch (error) {
      logger.error('Failed to save cache', error as Error, { filename });
    }
  }
  
  /**
   * Load candles from cache
   */
  private loadFromCache(filename: string): Candle[] | null {
    try {
      const filePath = path.join(this.cacheDir, filename);
      
      if (!fs.existsSync(filePath)) return null;
      
      // Check expiration
      const useCacheOnly = process.env.USE_CACHE_ONLY === 'true';
      if (!useCacheOnly) {
        const stats = fs.statSync(filePath);
        const ageHours = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60);
        if (ageHours > this.expiryHours) {
          logger.debug(`Cache expired (${ageHours.toFixed(1)}h old). Removing ${filename}...`);
          fs.unlinkSync(filePath);
          return null;
        }
      }
      
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      const candles: Candle[] = [];
      
      for (let i = 1; i < lines.length; i++) {
        const [timestamp, open, high, low, close, volume] = lines[i].split(',');
        candles.push({
          timestamp: parseInt(timestamp, 10),
          open: parseFloat(open),
          high: parseFloat(high),
          low: parseFloat(low),
          close: parseFloat(close),
          volume: parseFloat(volume),
        });
      }
      
      logger.debug(`Loaded ${candles.length} candles from cache ${filename}`);
      return candles;
    } catch (error) {
      logger.error('Failed to load cache', error as Error, { filename });
      return null;
    }
  }
  
  /**
   * Find partial cache that covers part of the requested range
   */
  private findPartialCache(request: CandleFetchRequest): Candle[] | null {
    const basePattern = `${request.chain || 'solana'}_${request.mint}_${request.startTime.toFormat('yyyyMMdd-HHmm')}_`;
    
    try {
      const files = fs.readdirSync(this.cacheDir)
        .filter(f => f.startsWith(basePattern) && f.endsWith('.csv'));
      
      if (files.length === 0) return null;
      
      const latestCache = files.sort().pop()!;
      return this.loadFromCache(latestCache);
    } catch {
      return null;
    }
  }
}

