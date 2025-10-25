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
const CACHE_EXPIRY_HOURS = 24;

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
    console.log(`Cached ${candles.length} candles to ${filename}`);
  } catch (error) {
    console.error(`Failed to save cache ${filename}:`, error);
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

    // Check expiration
    const stats = fs.statSync(filePath);
    const ageHours =
      (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60);
    if (ageHours > CACHE_EXPIRY_HOURS) {
      console.log(
        `Cache expired (${ageHours.toFixed(
          1
        )}h old). Removing ${filename}...`
      );
      fs.unlinkSync(filePath);
      return null;
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
    console.log(
      `Loaded ${candles.length} candles from cache ${filename}`
    );
    return candles;
  } catch (error) {
    console.error(`Failed to load cache ${filename}:`, error);
    return null;
  }
}

/* ============================================================================
 * API Fetch: Birdeye & Hybrid Helper
 * ========================================================================== */

/**
 * Fetches hybrid candles using the following granularity:
 *   - 5m: For the first 6 hours (detail at entry time)
 *   - 1h: For remainder of the range
 * Each fetch type remains easily swappable for upgrades.
 */
async function fetchFreshCandles(
  mint: string,
  startTime: DateTime,
  endTime: DateTime,
  chain: string = 'solana'
): Promise<Candle[]> {
  // Choose split between 5m and 1h granularity for hybrid fetching
  const splitPoint = startTime.plus({ hours: 6 });

  const from5m = Math.floor(startTime.toSeconds());
  const to5m = Math.floor(Math.min(splitPoint.toSeconds(), endTime.toSeconds()));
  const from1h = Math.floor(splitPoint.toSeconds());
  const to1h = Math.floor(endTime.toSeconds());

  let candles: Candle[] = [];

  // Fetch 5m (if any required)
  if (to5m > from5m) {
    const fiveMinCandles = await fetchBirdeyeCandles(
      mint,
      '5m',
      from5m,
      to5m,
      chain
    );
    candles = candles.concat(fiveMinCandles);
  }

  // Fetch 1h (if any required)
  if (to1h > from1h) {
    const oneHourCandles = await fetchBirdeyeCandles(
      mint,
      '1H',
      from1h,
      to1h,
      chain
    );
    candles = candles.concat(oneHourCandles);
  }

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
  });

  // Defensive: Normalize to Candle type
  const items: any[] = response.data?.data?.items ?? [];
  return items.map(item => ({
    timestamp: item.unix_time,
    open: item.o,
    high: item.h,
    low: item.l,
    close: item.c,
    volume: item.v,
  }));
}

/* ============================================================================
 * Public API: fetchHybridCandles
 * ========================================================================== */

/**
 * Fetches OHLCV candles for a given token using a "hybrid" strategy:
 *   - 5m granularity for the first 6 hours (detailed simulation support)
 *   - 1h granularity for the remaining window (efficient for longer timeframes)
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
  // Check cache (exact match)
  const cacheFilename = getCacheFilename(mint, startTime, endTime, chain);
  const cachedCandles = loadCandlesFromCache(cacheFilename);
  if (cachedCandles) {
    console.log(
      `Using cached candles for ${mint} (${cachedCandles.length} candles)`
    );
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
        console.log(
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

  // Otherwise, fetch from API and cache
  console.log(
    `Fetching fresh candles for ${mint}: ${startTime.toISO()} — ${endTime.toISO()}`
  );
  const sortedCandles = await fetchFreshCandles(
    mint,
    startTime,
    endTime,
    chain
  );
  if (sortedCandles.length > 0) {
    saveCandlesToCache(sortedCandles, cacheFilename);
  }
  return sortedCandles;
}

