#!/usr/bin/env ts-node
/**
 * Fetch OHLCV Data for Alerts (Last 3 Months from DuckDB)
 *
 * Fetches OHLCV candles for all alerts from results.duckdb (last 3 months):
 * - 10,000 x 1s candles for all alerts
 * - For alerts without existing 1m candles: fetch 20,000 1m candles
 * - For alerts with existing 1m candles: fetch 10,000 1m candles from last candle
 *   (which should be 165.799999967 hours past the alert)
 *
 * Uses the birdeye API key from .env and stores data via ingestion/ohlcv/storage packages.
 *
 * Rate Limiting:
 * - Enforces 50 RPS limit (25ms delay between requests = ~40 RPS effective)
 * - All requests go through rate limiter before API calls
 *
 * Usage:
 *   ts-node scripts/ingest/fetch-ohlcv-for-alerts-3m.ts [duckdb-path]
 */

import 'dotenv/config';
import { DateTime } from 'luxon';
import {
  getStorageEngine,
  initClickHouse,
  getClickHouseClient,
  getDuckDBClient,
} from '@quantbot/storage';
import { birdeyeClient } from '@quantbot/api-clients';
import { logger } from '@quantbot/utils';
import type { Chain, Candle } from '@quantbot/core';
import type { BirdeyeOHLCVResponse } from '@quantbot/api-clients';

const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

// Rate limiting: 50 RPS = 1 request every 20ms, use 25ms to be safe (40 RPS effective)
const BIRDEYE_RATE_LIMIT_MS = 25; // Minimum delay between requests (40 RPS = safe margin under 50 RPS)

// Credit optimization: 5000 candles = 120 credits, <1000 candles = 60 credits
const OPTIMAL_CHUNK_SIZE = 5000; // Maximum candles per request (most efficient)

/**
 * Rate limiter to ensure we don't exceed 50 RPS
 */
class RateLimiter {
  private lastRequestTime: number = 0;

  async waitIfNeeded(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < BIRDEYE_RATE_LIMIT_MS) {
      const waitTime = BIRDEYE_RATE_LIMIT_MS - timeSinceLastRequest;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }

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

  summary(): void {
    const totalTime = (Date.now() - this.startTime) / 1000;
    const avgRate = this.processedItems / totalTime;
    logger.info(
      `✅ Completed: ${this.processedItems}/${this.totalItems} in ${this.formatTime(totalTime)} ` +
        `(avg ${avgRate.toFixed(1)}/s)`
    );
  }
}

interface Alert {
  mint: string;
  call_datetime: string; // ISO string from DuckDB
  caller_name?: string;
}

interface FetchResult {
  mint: string;
  alertTime: DateTime;
  intervals: {
    '1s'?: { candles: number; success: boolean; error?: string };
    '1m'?: { candles: number; success: boolean; error?: string };
  };
}

/**
 * Get the last candle timestamp for a mint address from ClickHouse
 */
async function getLastCandleTimestamp(
  mint: string,
  chain: Chain,
  interval: string
): Promise<number | null> {
  const ch = getClickHouseClient();
  const escapedMint = mint.replace(/'/g, "''");
  const escapedChain = chain.replace(/'/g, "''");
  const escapedInterval = interval.replace(/'/g, "''");
  const tokenPattern = `${mint}%`;
  const tokenPatternSuffix = `%${mint}`;
  const escapedTokenPattern = tokenPattern.replace(/'/g, "''");
  const escapedTokenPatternSuffix = tokenPatternSuffix.replace(/'/g, "''");

  try {
    const result = await ch.query({
      query: `
        SELECT toUnixTimestamp(timestamp) as timestamp
        FROM ${CLICKHOUSE_DATABASE}.ohlcv_candles
        WHERE (token_address = '${escapedMint}'
               OR lower(token_address) = lower('${escapedMint}')
               OR token_address LIKE '${escapedTokenPattern}'
               OR lower(token_address) LIKE lower('${escapedTokenPattern}')
               OR token_address LIKE '${escapedTokenPatternSuffix}'
               OR lower(token_address) LIKE lower('${escapedTokenPatternSuffix}'))
          AND chain = '${escapedChain}'
          AND \`interval\` = '${escapedInterval}'
        ORDER BY timestamp DESC
        LIMIT 1
      `,
      format: 'JSONEachRow',
    });

    const data = (await result.json()) as Array<{ timestamp: number }>;

    if (!Array.isArray(data) || data.length === 0) {
      return null;
    }

    return data[0]?.timestamp || null;
  } catch (error: unknown) {
    logger.error('Error getting last candle timestamp', error as Error, { mint, interval });
    return null;
  }
}

/**
 * Check if 1m candles exist for a mint address
 */
async function has1mCandles(mint: string, chain: Chain, alertTime: DateTime): Promise<boolean> {
  const ch = getClickHouseClient();
  const escapedMint = mint.replace(/'/g, "''");
  const escapedChain = chain.replace(/'/g, "''");
  const tokenPattern = `${mint}%`;
  const tokenPatternSuffix = `%${mint}`;
  const escapedTokenPattern = tokenPattern.replace(/'/g, "''");
  const escapedTokenPatternSuffix = tokenPatternSuffix.replace(/'/g, "''");
  const alertUnix = Math.floor(alertTime.toSeconds());

  try {
    const result = await ch.query({
      query: `
        SELECT count() as count
        FROM ${CLICKHOUSE_DATABASE}.ohlcv_candles
        WHERE (token_address = '${escapedMint}'
               OR lower(token_address) = lower('${escapedMint}')
               OR token_address LIKE '${escapedTokenPattern}'
               OR lower(token_address) LIKE lower('${escapedTokenPattern}')
               OR token_address LIKE '${escapedTokenPatternSuffix}'
               OR lower(token_address) LIKE lower('${escapedTokenPatternSuffix}'))
          AND chain = '${escapedChain}'
          AND \`interval\` = '1m'
          AND timestamp >= toDateTime(${alertUnix})
      `,
      format: 'JSONEachRow',
    });

    const data = (await result.json()) as Array<{ count: number }>;

    if (!Array.isArray(data) || data.length === 0) {
      return false;
    }

    return data[0]?.count > 0 || false;
  } catch (error: unknown) {
    logger.error('Error checking 1m candles', error as Error, { mint });
    return false;
  }
}

/**
 * Fetch 1-second candles (10,000 candles)
 */
async function fetch1sCandles(
  mint: string,
  chain: Chain,
  alertTime: DateTime
): Promise<{ candles: Candle[]; success: boolean; error?: string }> {
  try {
    // Start 52 seconds before alert, fetch exactly 10,000 candles
    const startTime = alertTime.minus({ seconds: 52 });
    const endTime = startTime.plus({ seconds: 10000 }); // 10,000 seconds = 10,000 candles

    await rateLimiter.waitIfNeeded();

    // Fetch in chunks of 5000 (optimal chunk size)
    const allCandles: Candle[] = [];
    let currentStart = startTime;
    const totalSeconds = 10000;
    const chunkSeconds = OPTIMAL_CHUNK_SIZE; // 5000 seconds per chunk

    while (currentStart < endTime) {
      const currentEnd = currentStart.plus({ seconds: chunkSeconds });
      const actualEnd = currentEnd > endTime ? endTime : currentEnd;

      const birdeyeData = await birdeyeClient.fetchOHLCVData(
        mint,
        currentStart.toJSDate(),
        actualEnd.toJSDate(),
        '1s',
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
            return candleTime >= currentStart && candleTime <= actualEnd;
          })
          .sort((a: Candle, b: Candle) => a.timestamp - b.timestamp);

        allCandles.push(...chunkCandles);

        // Store chunk immediately
        if (chunkCandles.length > 0) {
          const storageEngine = getStorageEngine();
          await storageEngine.storeCandles(mint, chain, chunkCandles, '1s');
        }

        // Move to next chunk
        if (chunkCandles.length >= OPTIMAL_CHUNK_SIZE) {
          currentStart = currentStart.plus({ seconds: chunkSeconds });
        } else if (chunkCandles.length > 0) {
          const lastCandleTime = DateTime.fromSeconds(
            chunkCandles[chunkCandles.length - 1].timestamp
          );
          currentStart = lastCandleTime.plus({ seconds: 1 });
        } else {
          currentStart = actualEnd;
        }
      } else {
        // No data, move forward
        currentStart = actualEnd;
      }

      // Rate limit between chunks
      if (currentStart < endTime) {
        await rateLimiter.waitIfNeeded();
      }
    }

    return { candles: allCandles, success: true };
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    logger.error(`[1s] Failed to fetch 1s candles for ${mint}...`, error as Error);
    return { candles: [], success: false, error: errorMsg };
  }
}

/**
 * Fetch 1-minute candles
 * - If candles don't exist: fetch 20,000 candles from alert time
 * - If candles exist: fetch 10,000 candles from last candle
 *   (last candle should be at 165.799999967 hours past alert)
 */
async function fetch1mCandles(
  mint: string,
  chain: Chain,
  alertTime: DateTime
): Promise<{ candles: Candle[]; success: boolean; error?: string }> {
  try {
    const candlesExist = await has1mCandles(mint, chain, alertTime);
    let startTime: DateTime;
    let targetCandles: number;

    if (candlesExist) {
      // Get last candle timestamp
      const lastCandleTimestamp = await getLastCandleTimestamp(mint, chain, '1m');
      if (lastCandleTimestamp) {
        const lastCandleTime = DateTime.fromSeconds(lastCandleTimestamp);
        const expectedLastCandleTime = alertTime.plus({ hours: 165.799999967 });

        // Check if last candle is close to expected time (within 1 hour tolerance)
        const timeDiff = Math.abs(lastCandleTime.diff(expectedLastCandleTime, 'hours').hours);

        if (timeDiff < 1) {
          // Last candle is at expected time, fetch 10,000 from there
          startTime = lastCandleTime.plus({ minutes: 1 });
          targetCandles = 10000;
          logger.info(
            `[1m] Existing candles found for ${mint}..., last candle at ${lastCandleTime.toISO()}, fetching 10,000 from ${startTime.toISO()}`
          );
        } else {
          // Last candle is not at expected time, start from expected time
          startTime = expectedLastCandleTime.plus({ minutes: 1 });
          targetCandles = 10000;
          logger.info(
            `[1m] Existing candles found for ${mint}..., but last candle (${lastCandleTime.toISO()}) is not at expected time (${expectedLastCandleTime.toISO()}), fetching 10,000 from expected time`
          );
        }
      } else {
        // Fallback: start from alert + 165.799999967 hours
        const hoursAfterAlert = 165.799999967;
        startTime = alertTime.plus({ hours: hoursAfterAlert });
        targetCandles = 10000;
        logger.info(
          `[1m] Last candle timestamp not found, using alert + ${hoursAfterAlert}h for ${mint}...`
        );
      }
    } else {
      // No candles exist, fetch 20,000 from alert time
      startTime = alertTime.minus({ minutes: 52 }); // Start 52 minutes before alert (standard)
      targetCandles = 20000; // Fetch 20,000 candles
      logger.info(
        `[1m] No existing candles for ${mint}..., fetching 20,000 from ${startTime.toISO()}`
      );
    }

    const endTime = startTime.plus({ minutes: targetCandles }); // 1 minute per candle
    const now = DateTime.utc();
    const actualEnd = endTime > now ? now : endTime;

    // Fetch in chunks of 5000 (optimal chunk size)
    const allCandles: Candle[] = [];
    let currentStart = startTime;
    const chunkMinutes = OPTIMAL_CHUNK_SIZE; // 5000 minutes per chunk

    while (currentStart < actualEnd) {
      const optimalEnd = currentStart.plus({ minutes: chunkMinutes });
      const currentEnd = optimalEnd > actualEnd ? actualEnd : optimalEnd;

      await rateLimiter.waitIfNeeded();

      const birdeyeData = await birdeyeClient.fetchOHLCVData(
        mint,
        currentStart.toJSDate(),
        currentEnd.toJSDate(),
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
            return candleTime >= currentStart && candleTime <= currentEnd;
          })
          .sort((a: Candle, b: Candle) => a.timestamp - b.timestamp);

        allCandles.push(...chunkCandles);

        // Store chunk immediately
        if (chunkCandles.length > 0) {
          const storageEngine = getStorageEngine();
          await storageEngine.storeCandles(mint, chain, chunkCandles, '1m');
        }

        // Move to next chunk
        if (chunkCandles.length >= OPTIMAL_CHUNK_SIZE) {
          currentStart = currentStart.plus({ minutes: chunkMinutes });
        } else if (chunkCandles.length > 0) {
          const lastCandleTime = DateTime.fromSeconds(
            chunkCandles[chunkCandles.length - 1].timestamp
          );
          currentStart = lastCandleTime.plus({ minutes: 1 });
        } else {
          currentStart = currentEnd;
        }
      } else {
        // No data, move forward
        currentStart = currentStart.plus({ minutes: chunkMinutes });
        if (currentStart > actualEnd) {
          break;
        }
      }

      // Rate limit between chunks
      if (currentStart < actualEnd) {
        await rateLimiter.waitIfNeeded();
      }
    }

    return { candles: allCandles, success: true };
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    logger.error(`[1m] Failed to fetch 1m candles for ${mint}...`, error as Error);
    return { candles: [], success: false, error: errorMsg };
  }
}

/**
 * Query alerts from DuckDB (last 3 months)
 */
async function queryAlertsFromDuckDB(duckdbPath: string): Promise<Alert[]> {
  const client = getDuckDBClient(duckdbPath);

  // Calculate date 3 months ago
  const threeMonthsAgo = DateTime.utc().minus({ months: 3 });
  const threeMonthsAgoStr = threeMonthsAgo.toFormat('yyyy-MM-dd HH:mm:ss');

  const sql = `
    SELECT DISTINCT
      mint,
      call_datetime,
      caller_name
    FROM user_calls_d
    WHERE mint IS NOT NULL
      AND TRIM(CAST(mint AS VARCHAR)) != ''
      AND call_datetime IS NOT NULL
      AND call_datetime >= '${threeMonthsAgoStr}'
    ORDER BY call_datetime DESC
  `;

  const result = await client.query(sql);

  // Convert rows to Alert objects
  const mintIndex = result.columns.findIndex(
    (c: { name: string; type: string }) => c.name === 'mint'
  );
  const datetimeIndex = result.columns.findIndex(
    (c: { name: string; type: string }) => c.name === 'call_datetime'
  );
  const callerIndex = result.columns.findIndex(
    (c: { name: string; type: string }) => c.name === 'caller_name'
  );

  const alerts: Alert[] = [];
  for (const row of result.rows) {
    const mint = String(row[mintIndex]);
    const callDatetime = String(row[datetimeIndex]);
    const callerName =
      callerIndex >= 0 ? (row[callerIndex] ? String(row[callerIndex]) : undefined) : undefined;

    if (mint && callDatetime) {
      alerts.push({
        mint,
        call_datetime: callDatetime,
        caller_name: callerName,
      });
    }
  }

  return alerts;
}

/**
 * Main execution
 */
async function main() {
  try {
    const duckdbPath = process.argv[2] || 'results.duckdb';

    console.log('\n' + '='.repeat(80));
    console.log('🚀 OHLCV Fetch for Alerts (Last 3 Months from DuckDB)');
    console.log('='.repeat(80));
    logger.info(`📊 Rate limit: ${rateLimiter.getCurrentRate().toFixed(1)} RPS (max 50 RPS)`);
    logger.info(`📁 DuckDB path: ${duckdbPath}`);

    // Initialize storage
    await initClickHouse();
    logger.info('✅ ClickHouse initialized');

    // Query alerts from DuckDB
    logger.info('📊 Querying alerts from DuckDB (last 3 months)...');
    const alerts = await queryAlertsFromDuckDB(duckdbPath);
    console.log(`\n📊 Found ${alerts.length} alerts to process\n`);

    if (alerts.length === 0) {
      logger.warn('No alerts found in the last 3 months');
      process.exit(0);
    }

    // Initialize progress indicator
    const progress = new ProgressIndicator(alerts.length);

    // Process each alert
    const results: FetchResult[] = [];
    let processed = 0;
    let successCount = 0;
    let errorCount = 0;
    let totalCandlesFetched = { '1s': 0, '1m': 0 };

    for (const alert of alerts) {
      processed++;

      // Update progress indicator
      progress.update(processed, 'alerts');

      console.log(`\n${'─'.repeat(80)}`);
      console.log(`[${processed}/${alerts.length}] Alert | ${alert.call_datetime}`);

      try {
        const mint = alert.mint;
        const chain = 'solana' as Chain; // Default to solana
        const alertTime = DateTime.fromISO(alert.call_datetime, { zone: 'utc' });

        if (!alertTime.isValid) {
          logger.warn(`⚠️  Invalid alert time: ${alert.call_datetime}, skipping`);
          errorCount++;
          continue;
        }

        // Validate address length (Solana addresses are 32-44 chars)
        if (mint.length < 32 || mint.length > 44) {
          console.log(`  ⚠️  Invalid address length: ${mint.length} chars (expected 32-44)`);
          logger.warn(`⚠️  Invalid address length: ${mint.length} chars, skipping`);
          errorCount++;
          continue;
        }

        console.log(`  📌 Mint: ${mint} (${chain}) [${mint.length} chars]`);

        const result: FetchResult = {
          mint,
          alertTime,
          intervals: {},
        };

        // Fetch 1s candles (10,000 candles)
        process.stdout.write(`  [1s]  Fetching... `);
        const result1s = await fetch1sCandles(mint, chain, alertTime);
        result.intervals['1s'] = {
          candles: result1s.candles.length,
          success: result1s.success,
          error: result1s.error,
        };
        totalCandlesFetched['1s'] += result1s.candles.length;
        console.log(
          `${result1s.success ? '✅' : '❌'} ${result1s.candles.length.toLocaleString()} candles ${result1s.error ? `(${result1s.error})` : ''}`
        );

        // Fetch 1m candles (20,000 if none exist, 10,000 from last candle if they do)
        process.stdout.write(`  [1m]  Fetching... `);
        const result1m = await fetch1mCandles(mint, chain, alertTime);
        result.intervals['1m'] = {
          candles: result1m.candles.length,
          success: result1m.success,
          error: result1m.error,
        };
        totalCandlesFetched['1m'] += result1m.candles.length;
        console.log(
          `${result1m.success ? '✅' : '❌'} ${result1m.candles.length.toLocaleString()} candles ${result1m.error ? `(${result1m.error})` : ''}`
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
          (result.intervals['1s']?.candles || 0) + (result.intervals['1m']?.candles || 0);
        console.log(`  📈 Total: ${totalForAlert.toLocaleString()} candles fetched`);
      } catch (error) {
        errorCount++;
        console.log(`  ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        logger.error(`Failed to process alert`, error as Error, { alert });
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
    console.log(`  1m:  ${totalCandlesFetched['1m'].toLocaleString()}`);

    const grandTotal = totalCandlesFetched['1s'] + totalCandlesFetched['1m'];
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
        logger.warn(`  ${r.mint}...: ${errorIntervals}`);
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
