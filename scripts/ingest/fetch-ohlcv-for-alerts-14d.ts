#!/usr/bin/env ts-node
/**
 * Fetch OHLCV Data for Alerts (Last 14 Days)
 *
 * Fetches OHLCV candles for all alerts from the last 14 days:
 * - 5000 x 1s candles (starting -52 seconds from alert)
 * - 7d of 15s candles (starting from alert time)
 * - 1m candles up until now (starting -52 minutes from alert)
 * - 5m candles up until now (starting -260 minutes from alert)
 *
 * Uses the birdeye API key from .env and stores data via ingestion/ohlcv/storage packages.
 * Does not aggregate to save API credits.
 *
 * Credit Optimization:
 * - Always fetches in chunks of 5000 candles when possible (120 credits per chunk)
 * - Only uses smaller chunks for final requests (< 5000 candles = 60 credits)
 * - This maximizes credit efficiency: 5000 candles = 120 credits vs <1000 candles = 60 credits
 *
 * Rate Limiting:
 * - Enforces 50 RPS limit (25ms delay between requests = ~40 RPS effective)
 * - All requests go through rate limiter before API calls
 *
 * Usage:
 *   ts-node scripts/ingest/fetch-ohlcv-for-alerts-14d.ts
 */

import 'dotenv/config';
import { DateTime } from 'luxon';
import {
  AlertsRepository,
  TokensRepository,
  getStorageEngine,
  initClickHouse,
} from '@quantbot/storage';
import { OhlcvIngestionEngine } from '@quantbot/ohlcv';
import { birdeyeClient } from '@quantbot/api-clients';
import { logger } from '@quantbot/utils';
import type { Chain, Candle } from '@quantbot/core';
import type { BirdeyeOHLCVResponse } from '@quantbot/api-clients';

// Rate limiting: 50 RPS = 1 request every 20ms, use 25ms to be safe (40 RPS effective)
const BIRDEYE_RATE_LIMIT_MS = 25; // Minimum delay between requests (40 RPS = safe margin under 50 RPS)

// Credit optimization: 5000 candles = 120 credits, <1000 candles = 60 credits
// Always try to fetch 5000 candles when possible for better credit efficiency
const OPTIMAL_CHUNK_SIZE = 5000; // Maximum candles per request (most efficient)

/**
 * Rate limiter to ensure we don't exceed 50 RPS
 * Tracks last request time and enforces minimum delay
 */
class RateLimiter {
  private lastRequestTime: number = 0;

  /**
   * Wait if necessary to respect rate limit
   */
  async waitIfNeeded(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < BIRDEYE_RATE_LIMIT_MS) {
      const waitTime = BIRDEYE_RATE_LIMIT_MS - timeSinceLastRequest;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Get current request rate (requests per second)
   */
  getCurrentRate(): number {
    return 1000 / BIRDEYE_RATE_LIMIT_MS; // ~40 RPS
  }
}

// Global rate limiter instance
const rateLimiter = new RateLimiter();

/**
 * Progress indicator utilities
 */
class ProgressIndicator {
  private startTime: number;
  private totalItems: number;
  private processedItems: number = 0;
  private lastUpdate: number = 0;
  private readonly updateIntervalMs = 2000; // Update every 2 seconds

  constructor(totalItems: number) {
    this.totalItems = totalItems;
    this.startTime = Date.now();
  }

  /**
   * Update progress (only logs if enough time has passed)
   */
  update(current: number, itemLabel: string = 'items'): void {
    this.processedItems = current;
    const now = Date.now();

    if (now - this.lastUpdate >= this.updateIntervalMs || current === this.totalItems) {
      const elapsed = (now - this.startTime) / 1000;
      const percent = ((current / this.totalItems) * 100).toFixed(1);
      const rate = current / elapsed;
      const remaining = this.totalItems - current;
      const eta = remaining / rate;

      const elapsedStr = this.formatTime(elapsed);
      const etaStr = this.formatTime(eta);

      logger.info(
        `📊 Progress: ${current}/${this.totalItems} ${itemLabel} (${percent}%) | ` +
          `Elapsed: ${elapsedStr} | ETA: ${etaStr} | Rate: ${rate.toFixed(1)}/s`
      );

      this.lastUpdate = now;
    }
  }

  private formatTime(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${Math.round(seconds / 3600)}h`;
  }

  /**
   * Log summary
   */
  summary(): void {
    const totalTime = (Date.now() - this.startTime) / 1000;
    const avgRate = this.processedItems / totalTime;
    logger.info(
      `✅ Completed: ${this.processedItems}/${this.totalItems} in ${this.formatTime(totalTime)} ` +
        `(avg ${avgRate.toFixed(1)}/s)`
    );
  }
}

interface FetchResult {
  alertId: number;
  mint: string;
  chain: Chain;
  alertTime: DateTime;
  intervals: {
    '1s'?: { candles: number; success: boolean; error?: string };
    '15s'?: { candles: number; success: boolean; error?: string };
    '1m'?: { candles: number; success: boolean; error?: string };
    '5m'?: { candles: number; success: boolean; error?: string };
  };
}

/**
 * Fetch 1-second candles
 * Note: Birdeye may not support 1s intervals - will attempt and log if unsupported
 */
async function fetch1sCandles(
  mint: string,
  chain: Chain,
  alertTime: DateTime,
  engine: OhlcvIngestionEngine
): Promise<{ candles: Candle[]; success: boolean; error?: string }> {
  try {
    // Start 52 seconds before alert, fetch exactly 5000 candles (optimal chunk size)
    // 5000 candles = 120 credits (most efficient)
    const startTime = alertTime.minus({ seconds: 52 });
    const endTime = startTime.plus({ seconds: OPTIMAL_CHUNK_SIZE }); // 5000 seconds = 5000 candles

    // Logging handled at higher level

    // Rate limit: wait before making request
    await rateLimiter.waitIfNeeded();

    // Try to fetch from Birdeye directly (may not support 1s)
    const birdeyeData = await birdeyeClient.fetchOHLCVData(
      mint,
      startTime.toJSDate(),
      endTime.toJSDate(),
      '1s',
      chain
    );

    if (!birdeyeData || !birdeyeData.items || birdeyeData.items.length === 0) {
      logger.warn(
        `[1s] No 1s data returned from Birdeye for ${mint}... (may not support 1s interval)`
      );
      return { candles: [], success: false, error: 'No data returned (1s may not be supported)' };
    }

    const candles: Candle[] = birdeyeData.items
      .map((item: BirdeyeOHLCVResponse['items'][number]) => ({
        timestamp: item.unixTime,
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
        volume: item.volume,
      }))
      .filter((candle: Candle) => {
        const candleTime = DateTime.fromSeconds(candle.timestamp);
        return candleTime >= startTime && candleTime <= endTime;
      })
      .sort((a: Candle, b: Candle) => a.timestamp - b.timestamp);

    // Store candles if we got any
    if (candles.length > 0) {
      const storageEngine = getStorageEngine();
      await storageEngine.storeCandles(mint, chain, candles, '1s');
      // Stored successfully
    }

    return { candles, success: true };
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    logger.error(`[1s] Failed to fetch 1s candles for ${mint}...`, error as Error);
    return { candles: [], success: false, error: errorMsg };
  }
}

/**
 * Fetch 15-second candles (7 days worth)
 */
async function fetch15sCandles(
  mint: string,
  chain: Chain,
  alertTime: DateTime,
  engine: OhlcvIngestionEngine
): Promise<{ candles: Candle[]; success: boolean; error?: string }> {
  try {
    // Start from alert time, fetch 7 days worth (or until now if less than 7 days)
    const startTime = alertTime;
    const endTime = alertTime.plus({ days: 7 });
    const now = DateTime.utc();
    const actualEnd = endTime > now ? now : endTime;

    // Logging handled at higher level

    // Fetch in optimal chunks of 5000 candles (120 credits per chunk)
    // Only use smaller chunks for the final request if < 5000 candles remain
    const intervalSeconds = 15;
    const maxWindowSeconds = OPTIMAL_CHUNK_SIZE * intervalSeconds; // 5000 * 15 = 75000 seconds

    const allCandles: Candle[] = [];
    let currentStart = startTime;

    while (currentStart < actualEnd) {
      // Calculate optimal end time (5000 candles worth)
      const optimalEnd = currentStart.plus({ seconds: maxWindowSeconds });

      // If we can get a full 5000-candle chunk, use it; otherwise use remaining time
      const remainingSeconds = actualEnd.diff(currentStart, 'seconds').seconds;
      const shouldUseOptimalChunk = remainingSeconds >= maxWindowSeconds;

      const currentEnd = shouldUseOptimalChunk ? optimalEnd : actualEnd;
      const actualCurrentEnd = currentEnd > actualEnd ? actualEnd : currentEnd;

      // Log chunk size for credit tracking (only for large chunks)
      const estimatedCandles = Math.floor(
        actualCurrentEnd.diff(currentStart, 'seconds').seconds / intervalSeconds
      );
      if (estimatedCandles >= 1000) {
        logger.debug(`[15s] Chunk: ~${estimatedCandles} candles`);
      }

      // Rate limit: wait before making request
      await rateLimiter.waitIfNeeded();

      const birdeyeData = await birdeyeClient.fetchOHLCVData(
        mint,
        currentStart.toJSDate(),
        actualCurrentEnd.toJSDate(),
        '15s',
        chain
      );

      if (birdeyeData && birdeyeData.items && birdeyeData.items.length > 0) {
        const chunkCandles: Candle[] = birdeyeData.items
          .map((item: BirdeyeOHLCVResponse['items'][number]) => ({
            timestamp: item.unixTime,
            open: item.open,
            high: item.high,
            low: item.low,
            close: item.close,
            volume: item.volume,
          }))
          .filter((candle: Candle) => {
            const candleTime = DateTime.fromSeconds(candle.timestamp);
            return candleTime >= currentStart && candleTime <= actualCurrentEnd;
          })
          .sort((a: Candle, b: Candle) => a.timestamp - b.timestamp);

        allCandles.push(...chunkCandles);

        // Store chunk immediately
        if (chunkCandles.length > 0) {
          const storageEngine = getStorageEngine();
          await storageEngine.storeCandles(mint, chain, chunkCandles, '15s');
        }

        // Move to next chunk
        // If we got a full 5000 candles, move forward by that amount
        // Otherwise, move to the end of what we requested
        if (chunkCandles.length >= OPTIMAL_CHUNK_SIZE) {
          // Got a full chunk, move forward by exactly 5000 candles worth of time
          currentStart = currentStart.plus({ seconds: maxWindowSeconds });
        } else if (chunkCandles.length > 0) {
          // Partial chunk, move forward from last candle
          const lastCandleTime = DateTime.fromSeconds(
            chunkCandles[chunkCandles.length - 1].timestamp
          );
          currentStart = lastCandleTime.plus({ seconds: intervalSeconds });
        } else {
          // No data, move forward by time window
          currentStart = actualCurrentEnd;
        }
      } else {
        // No data in this chunk, move forward by optimal chunk size
        currentStart = currentStart.plus({ seconds: maxWindowSeconds });
        if (currentStart > actualEnd) {
          break; // No more data to fetch
        }
      }

      // Rate limiting is handled by rateLimiter.waitIfNeeded() before each request
    }

    // Summary logged at higher level

    return { candles: allCandles, success: true };
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    logger.error(
      `[15s] Failed to fetch 15s candles for ${mint}...`,
      error as Error
    );
    return { candles: [], success: false, error: errorMsg };
  }
}

/**
 * Fetch 1-minute candles up until now (starting -52 minutes from alert)
 */
async function fetch1mCandles(
  mint: string,
  chain: Chain,
  alertTime: DateTime,
  engine: OhlcvIngestionEngine
): Promise<{ candles: Candle[]; success: boolean; error?: string }> {
  try {
    // Start 52 minutes before alert, fetch until now
    const startTime = alertTime.minus({ minutes: 52 });
    const endTime = DateTime.utc();

    // Logging handled at higher level

    // Use the ingestion engine which handles chunking automatically
    const result = await engine.fetchCandles(mint, chain, alertTime, {
      useCache: true,
      forceRefresh: false,
    });

    // Fetch in optimal chunks of 5000 candles (120 credits per chunk)
    // Only use smaller chunks for the final request if < 5000 candles remain
    const intervalSeconds = 60; // 1 minute
    const maxWindowSeconds = OPTIMAL_CHUNK_SIZE * intervalSeconds; // 5000 * 60 = 300000 seconds

    const allCandles: Candle[] = [];
    let currentStart = startTime;

    while (currentStart < endTime) {
      // Calculate optimal end time (5000 candles worth)
      const optimalEnd = currentStart.plus({ seconds: maxWindowSeconds });

      // If we can get a full 5000-candle chunk, use it; otherwise use remaining time
      const remainingSeconds = endTime.diff(currentStart, 'seconds').seconds;
      const shouldUseOptimalChunk = remainingSeconds >= maxWindowSeconds;

      const currentEnd = shouldUseOptimalChunk ? optimalEnd : endTime;
      const actualCurrentEnd = currentEnd > endTime ? endTime : currentEnd;

      // Log chunk size for credit tracking (only for large chunks)
      const estimatedCandles = Math.floor(
        actualCurrentEnd.diff(currentStart, 'seconds').seconds / intervalSeconds
      );
      if (estimatedCandles >= 1000) {
        logger.debug(`[1m] Chunk: ~${estimatedCandles} candles`);
      }

      // Rate limit: wait before making request
      await rateLimiter.waitIfNeeded();

      const birdeyeData = await birdeyeClient.fetchOHLCVData(
        mint,
        currentStart.toJSDate(),
        actualCurrentEnd.toJSDate(),
        '1m',
        chain
      );

      if (birdeyeData && birdeyeData.items && birdeyeData.items.length > 0) {
        const chunkCandles: Candle[] = birdeyeData.items
          .map((item: BirdeyeOHLCVResponse['items'][number]) => ({
            timestamp: item.unixTime,
            open: item.open,
            high: item.high,
            low: item.low,
            close: item.close,
            volume: item.volume,
          }))
          .filter((candle: Candle) => {
            const candleTime = DateTime.fromSeconds(candle.timestamp);
            return candleTime >= currentStart && candleTime <= actualCurrentEnd;
          })
          .sort((a: Candle, b: Candle) => a.timestamp - b.timestamp);

        allCandles.push(...chunkCandles);

        // Store chunk immediately
        if (chunkCandles.length > 0) {
          const storageEngine = getStorageEngine();
          await storageEngine.storeCandles(mint, chain, chunkCandles, '1m');
        }

        // Move to next chunk
        // If we got a full 5000 candles, move forward by that amount
        // Otherwise, move to the end of what we requested
        if (chunkCandles.length >= OPTIMAL_CHUNK_SIZE) {
          // Got a full chunk, move forward by exactly 5000 candles worth of time
          currentStart = currentStart.plus({ seconds: maxWindowSeconds });
        } else if (chunkCandles.length > 0) {
          // Partial chunk, move forward from last candle
          const lastCandleTime = DateTime.fromSeconds(
            chunkCandles[chunkCandles.length - 1].timestamp
          );
          currentStart = lastCandleTime.plus({ seconds: intervalSeconds });
        } else {
          // No data, move forward by time window
          currentStart = actualCurrentEnd;
        }
      } else {
        // No data in this chunk, move forward by optimal chunk size
        currentStart = currentStart.plus({ seconds: maxWindowSeconds });
        if (currentStart > endTime) {
          break; // No more data to fetch
        }
      }

      // Rate limiting is handled by rateLimiter.waitIfNeeded() before each request
    }

    // Summary logged at higher level

    return { candles: allCandles, success: true };
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    logger.error(`[1m] Failed to fetch 1m candles for ${mint}...`, error as Error);
    return { candles: [], success: false, error: errorMsg };
  }
}

/**
 * Fetch 5-minute candles up until now (starting -260 minutes from alert)
 */
async function fetch5mCandles(
  mint: string,
  chain: Chain,
  alertTime: DateTime,
  engine: OhlcvIngestionEngine
): Promise<{ candles: Candle[]; success: boolean; error?: string }> {
  try {
    // Start 260 minutes (52 * 5) before alert, fetch until now
    const startTime = alertTime.minus({ minutes: 260 });
    const endTime = DateTime.utc();

    // Logging handled at higher level

    // Use the ingestion engine which handles chunking automatically
    const result = await engine.fetchCandles(mint, chain, alertTime, {
      useCache: true,
      forceRefresh: false,
    });

    // Fetch in optimal chunks of 5000 candles (120 credits per chunk)
    // Only use smaller chunks for the final request if < 5000 candles remain
    const intervalSeconds = 300; // 5 minutes
    const maxWindowSeconds = OPTIMAL_CHUNK_SIZE * intervalSeconds; // 5000 * 300 = 1500000 seconds

    const allCandles: Candle[] = [];
    let currentStart = startTime;

    while (currentStart < endTime) {
      // Calculate optimal end time (5000 candles worth)
      const optimalEnd = currentStart.plus({ seconds: maxWindowSeconds });

      // If we can get a full 5000-candle chunk, use it; otherwise use remaining time
      const remainingSeconds = endTime.diff(currentStart, 'seconds').seconds;
      const shouldUseOptimalChunk = remainingSeconds >= maxWindowSeconds;

      const currentEnd = shouldUseOptimalChunk ? optimalEnd : endTime;
      const actualCurrentEnd = currentEnd > endTime ? endTime : currentEnd;

      // Log chunk size for credit tracking (only for large chunks)
      const estimatedCandles = Math.floor(
        actualCurrentEnd.diff(currentStart, 'seconds').seconds / intervalSeconds
      );
      if (estimatedCandles >= 1000) {
        logger.debug(`[5m] Chunk: ~${estimatedCandles} candles`);
      }

      // Rate limit: wait before making request
      await rateLimiter.waitIfNeeded();

      const birdeyeData = await birdeyeClient.fetchOHLCVData(
        mint,
        currentStart.toJSDate(),
        actualCurrentEnd.toJSDate(),
        '5m',
        chain
      );

      if (birdeyeData && birdeyeData.items && birdeyeData.items.length > 0) {
        const chunkCandles: Candle[] = birdeyeData.items
          .map((item: BirdeyeOHLCVResponse['items'][number]) => ({
            timestamp: item.unixTime,
            open: item.open,
            high: item.high,
            low: item.low,
            close: item.close,
            volume: item.volume,
          }))
          .filter((candle: Candle) => {
            const candleTime = DateTime.fromSeconds(candle.timestamp);
            return candleTime >= currentStart && candleTime <= actualCurrentEnd;
          })
          .sort((a: Candle, b: Candle) => a.timestamp - b.timestamp);

        allCandles.push(...chunkCandles);

        // Store chunk immediately
        if (chunkCandles.length > 0) {
          const storageEngine = getStorageEngine();
          await storageEngine.storeCandles(mint, chain, chunkCandles, '5m');
        }

        // Move to next chunk
        // If we got a full 5000 candles, move forward by that amount
        // Otherwise, move to the end of what we requested
        if (chunkCandles.length >= OPTIMAL_CHUNK_SIZE) {
          // Got a full chunk, move forward by exactly 5000 candles worth of time
          currentStart = currentStart.plus({ seconds: maxWindowSeconds });
        } else if (chunkCandles.length > 0) {
          // Partial chunk, move forward from last candle
          const lastCandleTime = DateTime.fromSeconds(
            chunkCandles[chunkCandles.length - 1].timestamp
          );
          currentStart = lastCandleTime.plus({ seconds: intervalSeconds });
        } else {
          // No data, move forward by time window
          currentStart = actualCurrentEnd;
        }
      } else {
        // No data in this chunk, move forward by optimal chunk size
        currentStart = currentStart.plus({ seconds: maxWindowSeconds });
        if (currentStart > endTime) {
          break; // No more data to fetch
        }
      }

      // Rate limiting is handled by rateLimiter.waitIfNeeded() before each request
    }

    // Summary logged at higher level

    return { candles: allCandles, success: true };
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    logger.error(`[5m] Failed to fetch 5m candles for ${mint}...`, error as Error);
    return { candles: [], success: false, error: errorMsg };
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    console.log('\n' + '='.repeat(80));
    console.log('🚀 OHLCV Fetch for Alerts (Last 14 Days)');
    console.log('='.repeat(80));
    logger.info(`📊 Rate limit: ${rateLimiter.getCurrentRate().toFixed(1)} RPS (max 50 RPS)`);
    logger.info(`💰 Credit optimization: 5000 candles = 120 credits, <1000 candles = 60 credits`);

    // Initialize storage
    await initClickHouse();
    logger.info('✅ ClickHouse initialized');

    // Initialize repositories
    const alertsRepo = new AlertsRepository();
    const tokensRepo = new TokensRepository();
    const engine = new OhlcvIngestionEngine();
    await engine.initialize();

    // Get alerts from last 14 days
    const now = DateTime.utc();
    const fromDate = now.minus({ days: 14 });
    const toDate = now;

    logger.info(`📅 Fetching alerts from ${fromDate.toISO()} to ${toDate.toISO()}`);

    const alerts = await alertsRepo.findByTimeRange(fromDate.toJSDate(), toDate.toJSDate());
    console.log(`\n📊 Found ${alerts.length} alerts to process`);
    console.log(`📅 Date range: ${fromDate.toISO()} to ${toDate.toISO()}\n`);

    if (alerts.length === 0) {
      logger.warn('No alerts found in the last 14 days');
      process.exit(0);
    }

    // Initialize progress indicator
    const progress = new ProgressIndicator(alerts.length);

    // Process each alert
    const results: FetchResult[] = [];
    let processed = 0;
    let successCount = 0;
    let errorCount = 0;
    let totalCandlesFetched = { '1s': 0, '15s': 0, '1m': 0, '5m': 0 };

    for (const alert of alerts) {
      processed++;

      // Update progress indicator
      progress.update(processed, 'alerts');

      console.log(`\n${'─'.repeat(80)}`);
      console.log(
        `[${processed}/${alerts.length}] Alert #${alert.id} | ${alert.alertTimestamp.toISO()}`
      );

      try {
        // Get token (mint address) from tokenId
        const token = await tokensRepo.findById(alert.tokenId);
        if (!token) {
          logger.warn(
            `⚠️  Token not found for tokenId ${alert.tokenId}, skipping alert ${alert.id}`
          );
          errorCount++;
          continue;
        }

        const mint = token.address;
        const chain = token.chain;

        // Validate address length (Solana addresses are 32-44 chars)
        if (mint.length < 32 || mint.length > 44) {
          console.log(`  ⚠️  Invalid address length: ${mint.length} chars (expected 32-44)`);
          console.log(`  📌 Full address: ${mint}`);
          logger.warn(
            `⚠️  Invalid address length for tokenId ${alert.tokenId}: ${mint.length} chars, skipping alert ${alert.id}`
          );
          errorCount++;
          continue;
        }

        // Log full address for debugging (only first time we see a short address)
        if (mint.length < 40) {
          logger.debug(`Address length ${mint.length} chars: ${mint}`);
        }

        // Verify we're using the full address (not truncated)
        if (mint.length < 32 || mint.length > 44) {
          console.log(`  ❌ ERROR: Address length invalid: ${mint.length} chars`);
          console.log(`  Full address: ${mint}`);
          logger.error(`Invalid address length: ${mint.length} for tokenId ${alert.tokenId}`);
        }

        console.log(`  📌 Mint: ${mint} (${chain}) [${mint.length} chars]`);

        // Log full address to verify it's not truncated
        logger.debug(
          `Using full address for API: ${mint} (${mint.length} chars)`
        );

        const result: FetchResult = {
          alertId: alert.id,
          mint,
          chain,
          alertTime: alert.alertTimestamp,
          intervals: {},
        };

        // Fetch 1s candles (5000 candles, starting -52 seconds from alert)
        process.stdout.write(`  [1s]  Fetching... `);
        const result1s = await fetch1sCandles(mint, chain, alert.alertTimestamp, engine);
        result.intervals['1s'] = {
          candles: result1s.candles.length,
          success: result1s.success,
          error: result1s.error,
        };
        totalCandlesFetched['1s'] += result1s.candles.length;
        console.log(
          `${result1s.success ? '✅' : '❌'} ${result1s.candles.length.toLocaleString()} candles ${result1s.error ? `(${result1s.error})` : ''}`
        );

        // Fetch 15s candles (7 days worth, starting from alert time)
        process.stdout.write(`  [15s] Fetching... `);
        const result15s = await fetch15sCandles(mint, chain, alert.alertTimestamp, engine);
        result.intervals['15s'] = {
          candles: result15s.candles.length,
          success: result15s.success,
          error: result15s.error,
        };
        totalCandlesFetched['15s'] += result15s.candles.length;
        console.log(
          `${result15s.success ? '✅' : '❌'} ${result15s.candles.length.toLocaleString()} candles ${result15s.error ? `(${result15s.error})` : ''}`
        );

        // Fetch 1m candles (up until now, starting -52 minutes from alert)
        process.stdout.write(`  [1m]  Fetching... `);
        const result1m = await fetch1mCandles(mint, chain, alert.alertTimestamp, engine);
        result.intervals['1m'] = {
          candles: result1m.candles.length,
          success: result1m.success,
          error: result1m.error,
        };
        totalCandlesFetched['1m'] += result1m.candles.length;
        console.log(
          `${result1m.success ? '✅' : '❌'} ${result1m.candles.length.toLocaleString()} candles ${result1m.error ? `(${result1m.error})` : ''}`
        );

        // Fetch 5m candles (up until now, starting -260 minutes from alert)
        process.stdout.write(`  [5m]  Fetching... `);
        const result5m = await fetch5mCandles(mint, chain, alert.alertTimestamp, engine);
        result.intervals['5m'] = {
          candles: result5m.candles.length,
          success: result5m.success,
          error: result5m.error,
        };
        totalCandlesFetched['5m'] += result5m.candles.length;
        console.log(
          `${result5m.success ? '✅' : '❌'} ${result5m.candles.length.toLocaleString()} candles ${result5m.error ? `(${result5m.error})` : ''}`
        );

        results.push(result);

        // Check if all intervals succeeded
        const allSuccess = Object.values(result.intervals).every((r) => r?.success !== false);
        if (allSuccess) {
          successCount++;
        } else {
          errorCount++;
        }

        const totalForAlert =
          (result.intervals['1s']?.candles || 0) +
          (result.intervals['15s']?.candles || 0) +
          (result.intervals['1m']?.candles || 0) +
          (result.intervals['5m']?.candles || 0);
        console.log(`  📈 Total: ${totalForAlert.toLocaleString()} candles fetched`);

        // Rate limiting is handled by rateLimiter.waitIfNeeded() before each request
        // No additional delay needed between alerts since we're already rate-limited
      } catch (error) {
        errorCount++;
        console.log(`  ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        logger.error(`Failed to process alert ${alert.id}`, error as Error);
      }
    }

    progress.summary();

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 OHLCV Fetch Summary');
    console.log('='.repeat(80));
    console.log(`Total alerts processed: ${processed}`);
    console.log(`  ✅ Successful: ${successCount}`);
    console.log(`  ❌ Errors: ${errorCount}`);

    console.log(`\n📈 Total candles fetched:`);
    console.log(`  1s:  ${totalCandlesFetched['1s'].toLocaleString()}`);
    console.log(`  15s: ${totalCandlesFetched['15s'].toLocaleString()}`);
    console.log(`  1m:  ${totalCandlesFetched['1m'].toLocaleString()}`);
    console.log(`  5m:  ${totalCandlesFetched['5m'].toLocaleString()}`);

    const grandTotal =
      totalCandlesFetched['1s'] +
      totalCandlesFetched['15s'] +
      totalCandlesFetched['1m'] +
      totalCandlesFetched['5m'];
    console.log(`  ─────────────────────────`);
    console.log(`  Total: ${grandTotal.toLocaleString()} candles`);

    // Show errors if any
    const errors = results.filter((r) =>
      Object.values(r.intervals).some((i) => i?.success === false)
    );
    if (errors.length > 0) {
      logger.warn(`\n⚠️  ${errors.length} alerts had errors:`);
      errors.slice(0, 10).forEach((r) => {
        const errorIntervals = Object.entries(r.intervals)
          .filter(([_, i]) => i?.success === false)
          .map(([interval, i]) => `${interval}: ${i?.error || 'unknown'}`)
          .join(', ');
        logger.warn(`  Alert ${r.alertId} (${r.mint}...): ${errorIntervals}`);
      });
      if (errors.length > 10) {
        logger.warn(`  ... and ${errors.length - 10} more`);
      }
    }

    console.log('\n✅ OHLCV fetch complete!');
    console.log('='.repeat(80) + '\n');
    process.exit(0);
  } catch (error) {
    logger.error('❌ OHLCV fetch failed', error as Error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    logger.error('Unhandled error', error as Error);
    process.exit(1);
  });
}
