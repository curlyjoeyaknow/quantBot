/*******************************************************************************
 * Candle I/O Operations: Birdeye Fetching and ClickHouse Storage
 *
 * This module provides I/O operations for fetching token OHLCV data:
 *   - Birdeye API fetching with automatic chunking
 *   - ClickHouse integration via StorageEngine
 *   - Token metadata fetching
 *
 * Moved from @quantbot/simulation to break circular dependency.
 * Pure math operations (aggregation, etc.) remain in simulation.
 ******************************************************************************/

import { config } from 'dotenv';
// Override existing env vars to ensure .env file takes precedence
config({ override: true });
import axios from 'axios';
import { DateTime } from 'luxon';
import type { Candle } from '@quantbot/core';
import { logger, ConfigurationError, ApiError } from '@quantbot/utils';

/* ============================================================================
 * Constants & System Configuration
 * ========================================================================== */

// --- Birdeye API config (environment-driven for upgradeability) ---
// Read API key lazily to ensure dotenv is loaded
// Try BIRDEYE_API_KEY_1 first (matches birdeye-client.ts), then fallback to BIRDEYE_API_KEY
function getBirdeyeApiKey(): string {
  return process.env.BIRDEYE_API_KEY_1 || process.env.BIRDEYE_API_KEY || '';
}
const BIRDEYE_ENDPOINT = 'https://public-api.birdeye.so/defi/v3/ohlcv';

/* ============================================================================
 * API Fetch: Birdeye & Hybrid Helper
 * ========================================================================== */

/**
 * Fetches candles using specified interval for the given period.
 * This provides consistent granularity for technical indicators like Ichimoku.
 * Note: For very long periods (>7 days), consider using 1h candles for efficiency.
 */
async function fetchFreshCandles(
  mint: string,
  startTime: DateTime,
  endTime: DateTime,
  chain: string = 'solana',
  interval: '15s' | '1m' | '5m' | '1H' = '5m'
): Promise<Candle[]> {
  const from = Math.floor(startTime.toSeconds());
  const to = Math.floor(endTime.toSeconds());

  // Fetch candles with specified interval
  const candles = await fetchBirdeyeCandles(mint, interval, from, to, chain);

  // Ensure chronological order for all downstream consumers
  return candles.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Merges 5m and 1m candles, with 1m candles taking precedence in the alert window.
 * 1m candles replace 5m candles that overlap in time.
 */
function mergeCandles(
  candles5m: Candle[],
  candles1m: Candle[],
  alertTime: DateTime,
  windowMinutes: number = 30
): Candle[] {
  if (candles1m.length === 0) {
    return candles5m;
  }

  const alertStart = alertTime.minus({ minutes: windowMinutes });
  const alertEnd = alertTime.plus({ minutes: windowMinutes });
  const alertStartUnix = Math.floor(alertStart.toSeconds());
  const alertEndUnix = Math.floor(alertEnd.toSeconds());

  // Filter out 5m candles that overlap with the 1m window
  const filtered5m = candles5m.filter((candle) => {
    const candleEnd = candle.timestamp + 300; // 5m = 300 seconds
    // Remove 5m candle if it overlaps with 1m window
    return !(candle.timestamp < alertEndUnix && candleEnd > alertStartUnix);
  });

  // Combine and sort
  const merged = [...filtered5m, ...candles1m].sort((a, b) => a.timestamp - b.timestamp);

  logger.debug(
    `Merged candles: ${candles5m.length} 5m + ${candles1m.length} 1m = ${merged.length} total (removed ${candles5m.length - filtered5m.length} overlapping 5m candles)`
  );

  return merged;
}

/**
 * Makes a GET request to Birdeye OHLCV API. All params are explicit.
 * Automatically chunks requests into 5000-candle windows for optimal credit usage.
 * Throws on network/auth errors. Returns normalized array of Candle objects.
 *
 * @param mint     Solana token mint address
 * @param interval Candle interval: '1m', '5m', or '1H'
 * @param from     Start time (UNIX seconds)
 * @param to       End time (UNIX seconds)
 * @param chain    Blockchain name, e.g. 'solana'
 */
async function fetchBirdeyeCandles(
  mint: string,
  interval: '15s' | '1m' | '5m' | '1H',
  from: number,
  to: number,
  chain: string = 'solana'
): Promise<Candle[]> {
  try {
    const apiKey = getBirdeyeApiKey();
    if (!apiKey) {
      throw new ConfigurationError(
        'BIRDEYE_API_KEY is not set in environment variables',
        'BIRDEYE_API_KEY'
      );
    }

    // Calculate interval seconds and max candles per request (5000 limit)
    const intervalSeconds =
      interval === '15s' ? 15 : interval === '1m' ? 60 : interval === '5m' ? 300 : 3600;
    const MAX_CANDLES_PER_REQUEST = 5000;
    const maxWindowSeconds = MAX_CANDLES_PER_REQUEST * intervalSeconds;

    // Calculate total duration and number of chunks needed
    const durationSeconds = to - from;
    const estimatedCandles = Math.ceil(durationSeconds / intervalSeconds);

    // If we need more than 5000 candles, chunk the requests
    if (estimatedCandles > MAX_CANDLES_PER_REQUEST) {
      logger.debug(
        `Chunking request for ${mint.substring(0, 20)}... (${estimatedCandles} candles estimated, ${Math.ceil(estimatedCandles / MAX_CANDLES_PER_REQUEST)} chunks needed)`
      );

      const allCandles: Candle[] = [];
      let currentFrom = from;

      while (currentFrom < to) {
        // Calculate chunk end time (max 5000 candles worth)
        const chunkTo = Math.min(currentFrom + maxWindowSeconds, to);

        const chunkCandles = await fetchBirdeyeCandlesChunk(
          mint,
          interval,
          currentFrom,
          chunkTo,
          chain,
          apiKey
        );

        if (chunkCandles.length === 0) {
          // No more data available, break
          break;
        }

        allCandles.push(...chunkCandles);

        // Move to next chunk (start from last candle timestamp + 1 interval)
        const lastTimestamp = chunkCandles[chunkCandles.length - 1]?.timestamp;
        if (lastTimestamp) {
          currentFrom = lastTimestamp + intervalSeconds;
        } else {
          currentFrom = chunkTo;
        }

        // Small delay between chunks to avoid rate limits
        if (currentFrom < to) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      // Sort and deduplicate by timestamp
      const uniqueCandles = new Map<number, Candle>();
      for (const candle of allCandles) {
        if (!uniqueCandles.has(candle.timestamp)) {
          uniqueCandles.set(candle.timestamp, candle);
        }
      }

      return Array.from(uniqueCandles.values()).sort((a, b) => a.timestamp - b.timestamp);
    }

    // Single request (<= 5000 candles)
    return await fetchBirdeyeCandlesChunk(mint, interval, from, to, chain, apiKey);
  } catch (error: any) {
    // If it's a 400/404, that's expected for invalid tokens - return empty
    if (error.response?.status === 400 || error.response?.status === 404) {
      return [];
    }
    // Re-throw other errors (network, 500, etc.)
    throw error;
  }
}

/**
 * Fetches candles from Birdeye API with automatic chunking.
 * Exported for use in scripts that need direct access.
 */
export async function fetchBirdeyeCandlesDirect(
  mint: string,
  interval: '15s' | '1m' | '5m' | '1H',
  from: number,
  to: number,
  chain: string = 'solana'
): Promise<Candle[]> {
  return fetchBirdeyeCandles(mint, interval, from, to, chain);
}

/**
 * Fetches a single chunk of candles (up to 5000) from Birdeye API.
 * Internal helper used by fetchBirdeyeCandles for chunking.
 */
async function fetchBirdeyeCandlesChunk(
  mint: string,
  interval: '15s' | '1m' | '5m' | '1H',
  from: number,
  to: number,
  chain: string,
  apiKey: string
): Promise<Candle[]> {
  try {
    // Fetch by date range (up to 5000 candles)
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
      throw new ApiError(
        `Birdeye API returned status ${response.status}`,
        'Birdeye',
        response.status,
        response.data,
        { url: response.config?.url, method: response.config?.method }
      );
    }

    // Defensive: Normalize to Candle type
    let items: any[] = response.data?.data?.items ?? [];

    // If date range returned no items, try fetching by limit (latest 5000)
    if (items.length === 0) {
      logger.debug(
        `No candles found for date range, trying limit approach for ${mint.substring(0, 20)}...`
      );

      const limitResponse = await axios.get(BIRDEYE_ENDPOINT, {
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
          limit: 5000, // Use max 5000 candles per request
        },
        validateStatus: (status) => status < 500,
      });

      if (limitResponse.status === 200) {
        items = limitResponse.data?.data?.items ?? [];
        if (items.length > 0) {
          logger.debug(
            `Fetched ${items.length} candles using limit approach for ${mint.substring(0, 20)}...`
          );
          // Filter to only include candles within the requested time range
          items = items.filter((item: any) => {
            const timestamp = item.unix_time;
            return timestamp >= from && timestamp <= to;
          });
        }
      }
    }

    return items.map((item) => ({
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
 * Optimized Multi-Timeframe Fetching Strategy
 * ========================================================================== */

/**
 * Constants for optimized fetching strategy
 */
const FIFTY_TWO_HOURS_SEC = 52 * 60 * 60; // 52 hours in seconds
const THREE_MONTHS_SEC = 90 * 24 * 60 * 60; // 90 days in seconds
const MAX_CANDLES_15S = 5000;
const MAX_CANDLES_1M = 5000;
const MAX_CANDLES_5M = 5000;
const CANDLE_15S_SEC = 15;
const CANDLE_1M_SEC = 60;
const CANDLE_5M_SEC = 5 * 60;
const SEVENTEEN_DAYS_SEC = 17 * 24 * 60 * 60; // 17 days in seconds (safe limit for 5m)

/**
 * Fetches optimized multi-timeframe candles for maximum granularity and credit efficiency.
 *
 * Strategy (simplified):
 * 1. 1m: 52 hours back (3120 candles) + forward to fill 5000 candles total
 * 2. 15s: 52×15s periods back (13 minutes) + forward to fill 5000 candles total
 * 3. 5m: 52×5m periods back (4.33 hours) + forward in 17-day chunks for remainder
 *
 * This minimizes credit usage while maximizing granularity around alert time.
 *
 * @param mint Token mint address
 * @param alertTime Alert/call time (DateTime)
 * @param endTime End time for candles (DateTime, defaults to now)
 * @param chain Blockchain name (defaults to 'solana')
 * @returns Array of Candle objects, sorted by timestamp
 */
export async function fetchOptimizedCandlesForAlert(
  mint: string,
  alertTime: DateTime,
  endTime: DateTime = DateTime.utc(),
  chain: string = 'solana'
): Promise<Candle[]> {
  const alertUnix = Math.floor(alertTime.toSeconds());
  const endUnix = Math.floor(endTime.toSeconds());

  const allCandles: Candle[] = [];
  const apiKey = getBirdeyeApiKey();
  if (!apiKey) {
    throw new ConfigurationError(
      'BIRDEYE_API_KEY is not set in environment variables',
      'BIRDEYE_API_KEY'
    );
  }

  logger.debug('Fetching optimized candles for alert', {
    mint: mint.substring(0, 20),
    alertTime: alertTime.toISO(),
    endTime: endTime.toISO(),
  });

  // Step 1: Fetch 1m candles - 52 hours back (3120 candles) + forward to 5000 total
  const fiftyTwoHoursAgo = alertUnix - FIFTY_TWO_HOURS_SEC;
  const oneMHistoricalStart = fiftyTwoHoursAgo; // 52 hours back
  const oneMForwardEnd = oneMHistoricalStart + MAX_CANDLES_1M * CANDLE_1M_SEC; // Forward to fill 5000 candles

  logger.debug('Fetching 1m candles', {
    start: new Date(oneMHistoricalStart * 1000).toISOString(),
    end: new Date(Math.min(oneMForwardEnd, endUnix) * 1000).toISOString(),
    expectedCandles: MAX_CANDLES_1M,
  });

  const oneMCandles = await fetchBirdeyeCandles(
    mint,
    '1m',
    oneMHistoricalStart,
    Math.min(oneMForwardEnd, endUnix),
    chain
  );
  allCandles.push(...oneMCandles);

  // Step 2: Fetch 15s candles - 52×15s periods back (13 minutes) + forward to 5000 total
  const fiftyTwoPeriods15s = 52 * CANDLE_15S_SEC; // 780 seconds = 13 minutes
  const fifteenSStart = alertUnix - fiftyTwoPeriods15s;
  const fifteenSEnd = fifteenSStart + MAX_CANDLES_15S * CANDLE_15S_SEC; // Forward to fill 5000 candles

  // Only fetch 15s if alert time is within 3 months (Birdeye limit for 15s)
  const threeMonthsAgo = alertUnix - THREE_MONTHS_SEC;
  if (fifteenSStart >= threeMonthsAgo) {
    logger.debug('Fetching 15s candles', {
      start: new Date(fifteenSStart * 1000).toISOString(),
      end: new Date(Math.min(fifteenSEnd, endUnix) * 1000).toISOString(),
      expectedCandles: MAX_CANDLES_15S,
    });

    const fifteenSCandles = await fetchBirdeyeCandles(
      mint,
      '15s',
      fifteenSStart,
      Math.min(fifteenSEnd, endUnix),
      chain
    );
    allCandles.push(...fifteenSCandles);
  } else {
    logger.debug('Skipping 15s candles (alert >3 months ago)');
  }

  // Step 3: Fetch 5m candles - 52×5m periods back (4.33 hours) + forward in 17-day chunks
  const fiftyTwoPeriods5m = 52 * CANDLE_5M_SEC; // 15,600 seconds = 260 minutes = 4.33 hours
  const fiveMHistoricalStart = alertUnix - fiftyTwoPeriods5m;

  // Always start 5m fetch from 52×5m back, then continue forward in 17-day chunks
  // This ensures the 52×5m lookback is included in the first chunk
  let current5mFrom = fiveMHistoricalStart;

  if (current5mFrom < endUnix) {
    logger.debug('Fetching 5m candles', {
      start: new Date(current5mFrom * 1000).toISOString(),
      end: new Date(endUnix * 1000).toISOString(),
      firstChunkIncludes52Periods: true,
    });

    while (current5mFrom < endUnix) {
      // Never fetch more than 17 days at once (safe limit to avoid 400 errors)
      const chunk5mTo = Math.min(current5mFrom + SEVENTEEN_DAYS_SEC, endUnix);

      const fiveMCandles = await fetchBirdeyeCandles(mint, '5m', current5mFrom, chunk5mTo, chain);

      if (fiveMCandles.length === 0) {
        break; // No more data
      }

      allCandles.push(...fiveMCandles);
      current5mFrom = fiveMCandles[fiveMCandles.length - 1].timestamp + CANDLE_5M_SEC;

      // Small delay between chunks
      if (current5mFrom < endUnix) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }

  // Deduplicate and sort (prefer higher granularity candles when timestamps overlap)
  const uniqueCandles = new Map<number, Candle>();
  for (const candle of allCandles) {
    const existing = uniqueCandles.get(candle.timestamp);
    if (!existing) {
      uniqueCandles.set(candle.timestamp, candle);
    } else {
      // Prefer 15s > 1m > 5m when timestamps overlap
      const existingInterval =
        existing.timestamp === candle.timestamp
          ? allCandles.filter((c) => c.timestamp === existing.timestamp).length > 1
            ? '15s'
            : '1m'
          : '5m';
      // For now, just keep the one with higher volume (better data quality)
      if (candle.volume > existing.volume) {
        uniqueCandles.set(candle.timestamp, candle);
      }
    }
  }

  const sorted = Array.from(uniqueCandles.values()).sort((a, b) => a.timestamp - b.timestamp);

  logger.debug('Optimized fetch complete', {
    mint: mint.substring(0, 20),
    totalCandles: sorted.length,
    timeRange:
      sorted.length > 0
        ? `${new Date(sorted[0].timestamp * 1000).toISOString()} to ${new Date(sorted[sorted.length - 1].timestamp * 1000).toISOString()}`
        : 'N/A',
  });

  return sorted;
}

/* ============================================================================
 * Public API: fetchHybridCandles
 * ========================================================================== */

/**
 * Token metadata enriched from Birdeye API
 */
export interface TokenMetadata {
  name: string;
  symbol: string;
  marketCap?: number;
  price?: number;
  decimals?: number;
  socials?: {
    twitter?: string;
    telegram?: string;
    discord?: string;
    website?: string;
  };
  creator?: string;
  topWalletHoldings?: number; // Percentage held by top wallets
  volume24h?: number;
  priceChange24h?: number;
  logoURI?: string;
}

/**
 * Fetch token metadata (name, symbol, market cap, socials, creator, top wallet holdings) from Birdeye API
 * Tries multiple endpoints to get comprehensive metadata
 */
async function fetchTokenMetadata(
  mint: string,
  chain: string = 'solana'
): Promise<TokenMetadata | null> {
  const apiKey = getBirdeyeApiKey();
  if (!apiKey) {
    logger.debug('No Birdeye API key available for token metadata');
    return null;
  }

  const headers = {
    'X-API-KEY': apiKey,
    accept: 'application/json',
    'x-chain': chain,
  };

  // Try token overview endpoint first (more comprehensive data)
  try {
    const overviewResponse = await axios.get('https://public-api.birdeye.so/defi/token_overview', {
      headers,
      params: { address: mint },
      timeout: 10000,
      validateStatus: (status) => status < 500,
    });

    if (
      overviewResponse.status === 200 &&
      overviewResponse.data?.success &&
      overviewResponse.data?.data
    ) {
      const data = overviewResponse.data.data;
      return {
        name: data.name || `Token ${mint.substring(0, 8)}`,
        symbol: data.symbol || mint.substring(0, 4).toUpperCase(),
        marketCap: data.marketCap || data.mc || data.marketCapUsd,
        price: data.price || data.priceUsd,
        decimals: data.decimals,
        volume24h: data.volume24h || data.volume24hUsd,
        priceChange24h: data.priceChange24h,
        logoURI: data.logoURI || data.logo,
        socials: data.socials
          ? {
              twitter: data.socials.twitter,
              telegram: data.socials.telegram,
              discord: data.socials.discord,
              website: data.socials.website || data.website,
            }
          : undefined,
        creator: data.creator || data.creatorAddress,
        topWalletHoldings: data.topWalletHoldings || data.top10Holdings || data.top20Holdings,
      };
    }
  } catch (error: any) {
    logger.debug('Token overview endpoint failed, trying metadata endpoint', {
      token: mint.substring(0, 20),
      error: error.message,
    });
  }

  // Fallback to metadata endpoint
  try {
    const metadataResponse = await axios.get(
      'https://public-api.birdeye.so/defi/v3/token/meta-data/single',
      {
        headers,
        params: { address: mint },
        timeout: 10000,
        validateStatus: (status) => status < 500,
      }
    );

    if (
      metadataResponse.status === 200 &&
      metadataResponse.data?.success &&
      metadataResponse.data?.data
    ) {
      const data = metadataResponse.data.data;
      return {
        name: data.name || `Token ${mint.substring(0, 8)}`,
        symbol: data.symbol || mint.substring(0, 4).toUpperCase(),
        marketCap: data.marketCap || data.mc,
        price: data.price,
        decimals: data.decimals,
        volume24h: data.volume24h,
        priceChange24h: data.priceChange24h,
        logoURI: data.logoURI || data.logo,
        socials: data.socials
          ? {
              twitter: data.socials.twitter,
              telegram: data.socials.telegram,
              discord: data.socials.discord,
              website: data.socials.website || data.website,
            }
          : undefined,
        creator: data.creator || data.creatorAddress,
        topWalletHoldings: data.topWalletHoldings || data.top10Holdings,
      };
    }
  } catch (error: any) {
    logger.debug('Failed to fetch token metadata from Birdeye', {
      token: mint.substring(0, 20),
      error: error.message,
    });
  }

  return null;
}

/**
 * Fetches OHLCV candles for a given token using 5m granularity for the entire period.
 * If alertTime is provided, also fetches 1m candles for 30min before and after alertTime
 * for precise entry pricing.
 *
 * Checks and intelligently extends local CSV cache for quota/performance.
 * Designed for robust upgradeability to any future time partitioning scheme.
 *
 * @param mint      Token mint address
 * @param startTime Range start time (Luxon DateTime, UTC)
 * @param endTime   Range end time   (Luxon DateTime, UTC)
 * @param chain     Blockchain name (defaults to 'solana')
 * @param alertTime Optional alert time - if provided, fetches 1m candles for 30min before/after
 * @returns         Array of Candle objects, ascending by timestamp (merged 5m + 1m if alertTime provided)
 */
export async function fetchHybridCandles(
  mint: string,
  startTime: DateTime,
  endTime: DateTime,
  chain: string = 'solana',
  alertTime?: DateTime
): Promise<Candle[]> {
  // If alertTime is provided, extend startTime back by 52 periods (260 minutes) for Ichimoku
  // This ensures indicators can be calculated immediately when the alert comes in
  let actualStartTime = startTime;
  if (alertTime) {
    const ichimokuLookback = alertTime.minus({ minutes: 260 }); // 52 periods * 5 minutes
    // Only extend back if it's before the requested startTime
    if (ichimokuLookback < startTime) {
      actualStartTime = ichimokuLookback;
      logger.debug(
        `Extended start time back by 260 minutes for Ichimoku: ${actualStartTime.toISO()} (original: ${startTime.toISO()})`
      );
    }
  }

  // Try ClickHouse first (if enabled) - ClickHouse is a cache, so check it even in cache-only mode
  // If alertTime is provided, we'll use ClickHouse 5m candles but still fetch 1m candles from API
  let clickhouseCandles5m: Candle[] | null = null;
  if (process.env.USE_CLICKHOUSE === 'true' || process.env.CLICKHOUSE_HOST) {
    try {
      const { queryCandles } = await import('@quantbot/storage');
      const chCandles = await queryCandles(mint, chain, actualStartTime, endTime);
      if (chCandles.length > 0) {
        clickhouseCandles5m = chCandles;
        if (alertTime) {
          const alertUnix = Math.floor(alertTime.toSeconds());
          const historicalCount = chCandles.filter((c: any) => c.timestamp < alertUnix).length;
          logger.debug(
            `ClickHouse has ${chCandles.length} candles (${historicalCount} historical before alert). Will use as 5m base and fetch 1m from API.`
          );
        } else {
          // No alertTime, just use ClickHouse data and return early
          logger.debug(
            `Using ClickHouse candles for ${mint} (${chCandles.length} candles, from ${actualStartTime.toISO()})`
          );
          // Filter to requested range if we extended backwards
          if (actualStartTime < startTime) {
            const startUnix = Math.floor(startTime.toSeconds());
            const filtered = chCandles.filter((c: any) => c.timestamp >= startUnix);
            logger.debug(
              `Filtered ClickHouse candles to requested range: ${filtered.length} candles (had ${chCandles.length} with lookback)`
            );
            return filtered;
          }
          return chCandles;
        }
      }
    } catch (error: any) {
      logger.warn('ClickHouse query failed, falling back to API', { error: error.message, mint });
    }
  }

  // Fetch from API (unless USE_CACHE_ONLY is set)
  if (process.env.USE_CACHE_ONLY === 'true') {
    logger.debug(
      `⚠️ No cached candles found for ${mint}: ${startTime.toISO()} — ${endTime.toISO()}`
    );
    logger.debug(`   USE_CACHE_ONLY=true, returning empty array (no API calls)`);
    return [];
  }

  logger.debug(`Fetching fresh candles for ${mint}: ${startTime.toISO()} — ${endTime.toISO()}`);

  // Fetch 5m candles: if alertTime provided, start 52 periods before, then make multiple calls to fetch full history up to now
  // Use ClickHouse data if available, otherwise fetch from API
  let candles5m: Candle[];
  if (clickhouseCandles5m && alertTime) {
    // Use ClickHouse 5m candles, but we'll still fetch 1m candles below
    candles5m = clickhouseCandles5m;
    const alertUnix = Math.floor(alertTime.toSeconds());
    const historicalCount = candles5m.filter((c) => c.timestamp < alertUnix).length;
    logger.debug(
      `Using ClickHouse 5m candles: ${candles5m.length} total, ${historicalCount} historical (before alert)`
    );
  } else if (alertTime) {
    const MIN_HISTORICAL_5M = 52; // 52 periods for Ichimoku
    const CANDLE_5M_SEC = 5 * 60; // 300 seconds

    const alertUnix = Math.floor(alertTime.toSeconds());
    const minHistoricalSeconds = MIN_HISTORICAL_5M * CANDLE_5M_SEC; // 260 minutes = 52 periods

    // Start at least 52 periods (260 minutes) before alertTime for Ichimoku
    const fiveMStart = Math.max(
      Math.floor(actualStartTime.toSeconds()),
      alertUnix - minHistoricalSeconds // At least 52 periods back
    );

    // Fetch from 52 periods before alertTime all the way to endTime (now)
    // fetchBirdeyeCandles will automatically chunk into 5000-candle requests
    const fiveMEnd = Math.floor(endTime.toSeconds());

    logger.debug(
      `Fetching 5m candles (min ${MIN_HISTORICAL_5M} historical for Ichimoku, then full history to now): ${new Date(fiveMStart * 1000).toISOString()} — ${new Date(fiveMEnd * 1000).toISOString()}`
    );

    // Use fetchBirdeyeCandles directly - it handles chunking automatically (up to 5000 per call)
    candles5m = await fetchBirdeyeCandles(mint, '5m', fiveMStart, fiveMEnd, chain);

    // Verify we have at least 52 historical candles
    const historicalCount = candles5m.filter((c) => c.timestamp < alertUnix).length;
    if (historicalCount < MIN_HISTORICAL_5M) {
      logger.warn(
        `Only got ${historicalCount} historical 5m candles (need ${MIN_HISTORICAL_5M} for Ichimoku). Available data may be limited.`
      );
    } else {
      logger.debug(
        `Got ${historicalCount} historical 5m candles (>= ${MIN_HISTORICAL_5M} required for Ichimoku), ${candles5m.length} total candles`
      );
    }
  } else if (clickhouseCandles5m) {
    // No alertTime but we have ClickHouse data - use it
    candles5m = clickhouseCandles5m;
  } else {
    // No alertTime: fetch 5m candles for the full period (including lookback if any)
    // fetchBirdeyeCandles will automatically chunk into 5000-candle requests
    candles5m = await fetchBirdeyeCandles(
      mint,
      '5m',
      Math.floor(actualStartTime.toSeconds()),
      Math.floor(endTime.toSeconds()),
      chain
    );
  }

  // Filter to requested range for merging with 1m candles (but keep full range for Ichimoku)
  let candles5mFiltered = candles5m;
  if (actualStartTime < startTime) {
    const startUnix = Math.floor(startTime.toSeconds());
    candles5mFiltered = candles5m.filter((c) => c.timestamp >= startUnix);
    logger.debug(
      `Fetched ${candles5m.length} 5m candles with lookback (${candles5mFiltered.length} in requested range)`
    );
  }

  // If alertTime is provided, fetch up to 5000 1m candles (max per API call)
  // Ensure at least 52 historical candles (before alertTime) for Ichimoku
  let finalCandles = candles5mFiltered;
  let candles1m: Candle[] | null = null; // Store 1m candles separately for ClickHouse storage

  if (alertTime) {
    // Fetch 5000 1m candles starting 52 minutes before alert time
    // This ensures accurate entry prices at alert time and sufficient historical data for Ichimoku
    const CANDLES_BACK = 52; // 52 minutes before alert for Ichimoku
    const TOTAL_CANDLES = 5000; // Total candles to fetch
    const CANDLE_1M_SEC = 60;

    const alertUnix = Math.floor(alertTime.toSeconds());

    // Calculate time range: start 52 minutes before alert, fetch 5000 candles forward
    const oneMStart = alertUnix - CANDLES_BACK * CANDLE_1M_SEC; // 52 minutes before alert
    const oneMEnd = oneMStart + TOTAL_CANDLES * CANDLE_1M_SEC; // 5000 candles from start

    // Cap end time to requested endTime if it's earlier
    const oneMEndCapped = Math.min(oneMEnd, Math.floor(endTime.toSeconds()));

    logger.debug(
      `Fetching ${TOTAL_CANDLES} 1m candles starting ${CANDLES_BACK} minutes before alert: ${new Date(oneMStart * 1000).toISOString()} — ${new Date(oneMEndCapped * 1000).toISOString()}`
    );

    candles1m = await fetchFreshCandles(
      mint,
      DateTime.fromSeconds(oneMStart),
      DateTime.fromSeconds(oneMEndCapped),
      chain,
      '1m'
    );

    // Verify we have at least 52 historical candles
    const historicalCount = candles1m.filter((c: Candle) => c.timestamp < alertUnix).length;
    if (historicalCount < CANDLES_BACK) {
      logger.warn(
        `Only got ${historicalCount} historical 1m candles (need ${CANDLES_BACK} for Ichimoku). Available data may be limited.`
      );
    } else {
      logger.debug(
        `Got ${historicalCount} historical 1m candles (>= ${CANDLES_BACK} required for Ichimoku)`
      );
    }

    // Merge filtered 5m and 1m candles, with 1m taking precedence where they overlap
    // Since we have 5000 1m candles (52 back + 4948 forward), merge all of them
    // The merge function will replace 5m candles with 1m candles where they overlap
    finalCandles = mergeCandles(
      candles5mFiltered,
      candles1m,
      alertTime,
      Math.floor((oneMEndCapped - oneMStart) / 60)
    );
  }

  // Return full candles5m (with lookback) so Ichimoku can use all available data
  // The lookback candles are included so indicators can be calculated immediately
  if (alertTime && actualStartTime < startTime) {
    // Prepend lookback candles to finalCandles for Ichimoku calculations
    const startUnix = Math.floor(startTime.toSeconds());
    const lookbackCandles = candles5m.filter((c) => c.timestamp < startUnix);
    finalCandles = [...lookbackCandles, ...finalCandles].sort((a, b) => a.timestamp - b.timestamp);
    logger.debug(
      `Returning ${finalCandles.length} candles (${lookbackCandles.length} lookback + ${finalCandles.length - lookbackCandles.length} requested range) for Ichimoku`
    );
  }

  if (finalCandles.length > 0) {
    // Save to ClickHouse if enabled
    if (process.env.USE_CLICKHOUSE === 'true' || process.env.CLICKHOUSE_HOST) {
      try {
        const { insertCandles } = await import('@quantbot/storage');
        // Save full 5m candles (with lookback) to ClickHouse
        if (candles5m.length > 0) {
          await insertCandles(mint, chain, candles5m, '5m');
        }
        if (alertTime && candles1m) {
          // Store ALL 1m candles that were fetched (up to 5000), not just a 60-minute window
          // This ensures we have the full historical data for future use
          if (candles1m.length > 0) {
            await insertCandles(mint, chain, candles1m, '1m');
            logger.debug(
              `✅ Saved ${candles1m.length} 1m candles to ClickHouse (full range, not just alert window)`
            );
          }
        }
        logger.debug(`✅ Saved candles to ClickHouse for ${mint.substring(0, 20)}...`);
      } catch (error: any) {
        logger.error('Failed to save to ClickHouse', error as Error, {
          mint: mint.substring(0, 20),
        });
        // Don't throw - continue processing other tokens
      }
    }
  } else {
    // Log when no candles are returned (for debugging)
    if (process.env.DEBUG_CANDLES === 'true') {
      logger.debug(
        `⚠️ No candles returned for ${mint.substring(0, 20)}... (token may not exist or have no data)`
      );
    }
  }

  // Fetch and log token metadata (name, symbol, market cap, socials, creator, top wallet holdings) - async, don't block
  fetchTokenMetadata(mint, chain)
    .then((metadata) => {
      if (metadata) {
        logger.info('Token metadata enriched', {
          mint: mint.substring(0, 20),
          name: metadata.name,
          symbol: metadata.symbol,
          marketCap: metadata.marketCap,
          price: metadata.price,
          creator: metadata.creator,
          topWalletHoldings: metadata.topWalletHoldings,
          socials: metadata.socials,
          volume24h: metadata.volume24h,
          priceChange24h: metadata.priceChange24h,
        });
      }
    })
    .catch((err) => {
      logger.debug('Failed to fetch token metadata (non-blocking)', { error: err.message });
    });

  return finalCandles;
}

/**
 * Fetches OHLCV candles with token metadata enrichment.
 * Same as fetchHybridCandles but also returns token metadata (name, symbol, market cap).
 *
 * @param mint      Token mint address
 * @param startTime Range start time (Luxon DateTime, UTC)
 * @param endTime   Range end time   (Luxon DateTime, UTC)
 * @param chain     Blockchain name (defaults to 'solana')
 * @param alertTime Optional alert time - if provided, fetches 1m candles for 30min before/after
 * @returns         Object with candles array and token metadata
 */
export async function fetchHybridCandlesWithMetadata(
  mint: string,
  startTime: DateTime,
  endTime: DateTime,
  chain: string = 'solana',
  alertTime?: DateTime
): Promise<{ candles: Candle[]; metadata: TokenMetadata | null }> {
  const candles = await fetchHybridCandles(mint, startTime, endTime, chain, alertTime);
  const metadata = await fetchTokenMetadata(mint, chain);

  return { candles, metadata };
}
