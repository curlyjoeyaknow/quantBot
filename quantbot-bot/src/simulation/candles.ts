/*******************************************************************************
 * Candle Utilities: Type Definition, Birdeye Fetching, and Local Caching
 * 
 * This module provides:
 *   - The Candle type (OHLCV format, normalized for all consumption)
 *   - Robust and upgradeable utilities for fetching token OHLCV data from Birdeye
 *   - A simple yet upgradeable CSV-based cache to optimize API quota and latency
 * 
 * Consistent structure, sectioning, and code-level documentation keep this
 * module readable, maintainable, and easily upgradable for future requirements.
 ******************************************************************************/

import axios from 'axios';
import { DateTime } from 'luxon';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import { birdeyeClient } from '../api/birdeye-client';

/* ============================================================================
 * Candle Type Definition
 * ========================================================================== */

/**
 * Represents a single OHLCV (Open/High/Low/Close/Volume) candle.
 * All price fields are in quoted currency (e.g., USD). Volume is also quote denom.
 * - timestamp: UNIX timestamp (seconds UTC)
 */
export type Candle = {
  timestamp: number; // Candle open time (UNIX epoch, seconds, UTC)
  open: number;      // Open price
  high: number;      // High price in the interval
  low: number;       // Low price in the interval
  close: number;     // Close (last) price in the interval
  volume: number;    // Volume (quoted currency)
};

/* ============================================================================
 * Constants & System Configuration
 * ========================================================================== */

// --- Birdeye API config (environment-driven for upgradeability) ---
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || '';
const BIRDEYE_ENDPOINT = 'https://public-api.birdeye.so/defi/v3/ohlcv';

// --- Candle cache settings ---
const CACHE_DIR = path.join(process.cwd(), 'cache');
// Extended cache expiry for simulations - use cached data when available
const CACHE_EXPIRY_HOURS = process.env.USE_CACHE_ONLY === 'true' ? 999999 : 24;

// --- Ensure cache directory exists (idempotent) ---
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/* ============================================================================
 * CSV Cache Utilities
 * ========================================================================== */

/**
 * Generate a cache filename for specified token and time range on a chain.
 * Allows deterministic lookup and simplifies cache management/upgrade.
 */
function getCacheFilename(
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
 * Persist an array of Candle objects to the cache folder as a CSV file.
 * Supplies an upgrade point (e.g., for binary or compressed storage).
 */
function saveCandlesToCache(candles: Candle[], filename: string): void {
  try {
    const csvContent = [
      'timestamp,open,high,low,close,volume',
      ...candles.map(c =>
        `${c.timestamp},${c.open},${c.high},${c.low},${c.close},${c.volume}`
      ),
    ].join('\n');

    fs.writeFileSync(path.join(CACHE_DIR, filename), csvContent);
    logger.debug('Cached candles', { count: candles.length, filename });
  } catch (error) {
    logger.error('Failed to save cache', error as Error, { filename });
  }
}

/**
 * Load candles from CSV cache, or null if not present or expired.
 * Automatic cache expiry and removal ensures maintainability.
 */
function loadCandlesFromCache(filename: string): Candle[] | null {
  try {
    const filePath = path.join(CACHE_DIR, filename);

    if (!fs.existsSync(filePath)) return null;

    // Check expiration (skip if USE_CACHE_ONLY is set)
    if (process.env.USE_CACHE_ONLY !== 'true') {
    const stats = fs.statSync(filePath);
    const ageHours =
      (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60);
    if (ageHours > CACHE_EXPIRY_HOURS) {
      logger.debug(
        `Cache expired (${ageHours.toFixed(
          1
        )}h old). Removing ${filename}...`
      );
      fs.unlinkSync(filePath);
      return null;
      }
    }

    // Parse CSV
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
    logger.debug(
      `Loaded ${candles.length} candles from cache ${filename}`
    );
    return candles;
  } catch (error) {
    logger.error('Failed to load cache', error as Error, { filename });
    return null;
  }
}

/* ============================================================================
 * API Fetch: Birdeye & Hybrid Helper
 * ========================================================================== */

/**
 * Fetches candles using 5m granularity for the entire period.
 * This provides consistent granularity for technical indicators like Ichimoku.
 * Note: For very long periods (>7 days), consider using 1h candles for efficiency.
 */
async function fetchFreshCandles(
  mint: string,
  startTime: DateTime,
  endTime: DateTime,
  chain: string = 'solana'
): Promise<Candle[]> {
  const from = Math.floor(startTime.toSeconds());
  const to = Math.floor(endTime.toSeconds());

  // Fetch 5m candles for the entire period
  const candles = await fetchBirdeyeCandles(
      mint,
      '5m',
    from,
    to,
      chain
    );

  // Ensure chronological order for all downstream consumers
  return candles.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Makes a GET request to Birdeye OHLCV API. All params are explicit.
 * Throws on network/auth errors. Returns normalized array of Candle objects.
 * 
 * @param mint     Solana token mint address
 * @param interval Candle interval: '5m' or '1H'
 * @param from     Start time (UNIX seconds)
 * @param to       End time (UNIX seconds)
 * @param chain    Blockchain name, e.g. 'solana'
 */
async function fetchBirdeyeCandles(
  mint: string,
  interval: '5m' | '1H',
  from: number,
  to: number,
  chain: string = 'solana'
): Promise<Candle[]> {
  try {
    const response = await axios.get(BIRDEYE_ENDPOINT, {
      headers: {
        'X-API-KEY': BIRDEYE_API_KEY,
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
        padding: true, // Always fill missing intervals with zeros
        outlier: true, // Remove outliers (Birdeye-API specific)
      },
      validateStatus: (status) => status < 500, // Don't throw on 4xx errors
    });

    // Handle API errors gracefully
    if (response.status === 400 || response.status === 404) {
      // Token not found or invalid - return empty array (not an error)
      return [];
    }

    if (response.status !== 200) {
      throw new Error(`Birdeye API returned status ${response.status}`);
    }

    // Defensive: Normalize to Candle type
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
    // If it's a 400/404, that's expected for invalid tokens - return empty
    if (error.response?.status === 400 || error.response?.status === 404) {
      return [];
    }
    // Re-throw other errors (network, 500, etc.)
    throw error;
  }
}

/* ============================================================================
 * Public API: fetchHybridCandles
 * ========================================================================== */

/**
 * Fetches OHLCV candles for a given token using 5m granularity for the entire period.
 * This provides consistent granularity for technical indicators like Ichimoku Cloud.
 * 
 * Checks and intelligently extends local CSV cache for quota/performance. 
 * Designed for robust upgradeability to any future time partitioning scheme.
 * 
 * @param mint      Token mint address
 * @param startTime Range start time (Luxon DateTime, UTC)
 * @param endTime   Range end time   (Luxon DateTime, UTC)
 * @param chain     Blockchain name (defaults to 'solana')
 * @returns         Array of Candle objects, ascending by timestamp
 */
export async function fetchHybridCandles(
  mint: string,
  startTime: DateTime,
  endTime: DateTime,
  chain: string = 'solana'
): Promise<Candle[]> {
  // Try ClickHouse first (if enabled) - ClickHouse is a cache, so check it even in cache-only mode
  if (process.env.USE_CLICKHOUSE === 'true' || process.env.CLICKHOUSE_HOST) {
    try {
      const { queryCandles } = await import('../storage/clickhouse-client');
      const clickhouseCandles = await queryCandles(mint, chain, startTime, endTime);
      if (clickhouseCandles.length > 0) {
        logger.debug(
          `Using ClickHouse candles for ${mint} (${clickhouseCandles.length} candles)`
        );
        return clickhouseCandles;
      }
    } catch (error: any) {
      logger.warn('ClickHouse query failed, falling back to CSV cache', { error: error.message, mint });
    }
  }
  
  // Check CSV cache (exact match)
  const cacheFilename = getCacheFilename(mint, startTime, endTime, chain);
  const cachedCandles = loadCandlesFromCache(cacheFilename);
  if (cachedCandles) {
    logger.debug(
      `Using cached candles for ${mint} (${cachedCandles.length} candles)`
    );
    // Also ensure it's in ClickHouse (idempotent - won't duplicate)
    // Skip sync if USE_CACHE_ONLY is set (to avoid database connection errors)
    if (process.env.USE_CACHE_ONLY !== 'true' && (process.env.USE_CLICKHOUSE === 'true' || process.env.CLICKHOUSE_HOST)) {
      try {
        const { insertCandles } = await import('../storage/clickhouse-client');
        const interval = cachedCandles.length > 1 && (cachedCandles[1].timestamp - cachedCandles[0].timestamp) <= 600 ? '5m' : '1h';
        await insertCandles(mint, chain, cachedCandles, interval);
        logger.debug(`✅ Synced ${cachedCandles.length} cached candles to ClickHouse for ${mint.substring(0, 20)}...`);
      } catch (error: any) {
        // Silently continue - ClickHouse may already have the data
      }
    }
    return cachedCandles;
  }

  // Look for partial cache (matching mint & start, wider end)
  const basePattern = `${chain}_${mint}_${startTime.toFormat(
    'yyyyMMdd-HHmm'
  )}_`;
  const cacheFiles = fs
    .readdirSync(CACHE_DIR)
    .filter(f => f.startsWith(basePattern) && f.endsWith('.csv'));

  if (cacheFiles.length > 0) {
    // Use latest-available partial cache if it's sufficiently fresh
    const latestCache = cacheFiles.sort().pop()!;
    const cachedData = loadCandlesFromCache(latestCache);
    if (cachedData && cachedData.length > 0) {
      const lastCachedTime = DateTime.fromSeconds(
        cachedData[cachedData.length - 1].timestamp
      );
      if (endTime.diff(lastCachedTime, 'hours').hours < 1) {
        logger.debug(
          `Extending recent cache from ${lastCachedTime.toFormat(
            'yyyy-MM-dd HH:mm'
          )} to ${endTime.toFormat('yyyy-MM-dd HH:mm')}`
        );
        // Only fetch candles missing after cached range
        const newCandles = await fetchFreshCandles(
          mint,
          lastCachedTime,
          endTime,
          chain
        );
        const combinedCandles = [...cachedData, ...newCandles];
        saveCandlesToCache(combinedCandles, cacheFilename);
        return combinedCandles;
      }
    }
  }

  // Otherwise, fetch from API and cache (unless USE_CACHE_ONLY is set)
  if (process.env.USE_CACHE_ONLY === 'true') {
    logger.debug(
      `⚠️ No cached candles found for ${mint}: ${startTime.toISO()} — ${endTime.toISO()}`
    );
    logger.debug(`   USE_CACHE_ONLY=true, returning empty array (no API calls)`);
    return [];
  }
  
  logger.debug(
    `Fetching fresh candles for ${mint}: ${startTime.toISO()} — ${endTime.toISO()}`
  );
  const sortedCandles = await fetchFreshCandles(
    mint,
    startTime,
    endTime,
    chain
  );
  if (sortedCandles.length > 0) {
    // Save to CSV cache (always)
    saveCandlesToCache(sortedCandles, cacheFilename);
    
    // Also save to ClickHouse if enabled
    if (process.env.USE_CLICKHOUSE === 'true' || process.env.CLICKHOUSE_HOST) {
      try {
        const { insertCandles } = await import('../storage/clickhouse-client');
        // Detect interval from candles
        const interval = sortedCandles.length > 1 && (sortedCandles[1].timestamp - sortedCandles[0].timestamp) <= 600 ? '5m' : '1h';
        await insertCandles(mint, chain, sortedCandles, interval);
        logger.debug(`✅ Saved ${sortedCandles.length} candles to ClickHouse for ${mint.substring(0, 20)}...`);
      } catch (error: any) {
        logger.error('Failed to save to ClickHouse', error as Error, { mint: mint.substring(0, 20) });
        // Don't throw - continue processing other tokens
      }
    }
  } else {
    // Log when no candles are returned (for debugging)
    if (process.env.DEBUG_CANDLES === 'true') {
      logger.debug(`⚠️ No candles returned for ${mint.substring(0, 20)}... (token may not exist or have no data)`);
    }
  }
  return sortedCandles;
}

