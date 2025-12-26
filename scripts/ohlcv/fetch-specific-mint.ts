#!/usr/bin/env ts-node

/**
 * Script to fetch OHLCV data for a specific mint address
 *
 * Usage:
 *   ts-node scripts/ohlcv/fetch-specific-mint.ts <mint-address> [launch-date]
 *
 * Example:
 *   ts-node scripts/ohlcv/fetch-specific-mint.ts 8wXzwpLjk6QJMYYC1VHueNnxRVW2nFGvQjgEnV4Mv8sY 2024-12-01
 */

import { DateTime } from 'luxon';
import { fetchBirdeyeCandles, getBirdeyeClient } from '@quantbot/api-clients';
import { getStorageEngine } from '@quantbot/storage';
import { logger } from '@quantbot/utils';
import type { Candle } from '@quantbot/core';

const MINT_ADDRESS = process.argv[2];
const LAUNCH_DATE_STR = process.argv[3] || '2024-12-01';

if (!MINT_ADDRESS) {
  console.error('Usage: ts-node scripts/ohlcv/fetch-specific-mint.ts <mint-address> [launch-date]');
  process.exit(1);
}

// Parse launch date (assume UTC, start of day)
const launchDate = DateTime.fromISO(LAUNCH_DATE_STR, { zone: 'utc' }).startOf('day');
const now = DateTime.utc();

if (!launchDate.isValid) {
  console.error(`Invalid launch date: ${LAUNCH_DATE_STR}`);
  process.exit(1);
}

console.log(`Fetching OHLCV for mint: ${MINT_ADDRESS}`);
console.log(`Launch date: ${launchDate.toISO()}`);
console.log(`End date: ${now.toISO()}`);
console.log('');

const storage = getStorageEngine();
const chain = 'solana';

async function fetchAndStore(
  interval: '1s' | '15s' | '1m' | '5m' | '1H',
  startTime: DateTime,
  endTime: DateTime,
  description: string
): Promise<number> {
  console.log(`\n📊 Fetching ${description}...`);
  console.log(`   Interval: ${interval}`);
  console.log(`   From: ${startTime.toISO()}`);
  console.log(`   To: ${endTime.toISO()}`);

  try {
    const fromUnix = Math.floor(startTime.toSeconds());
    const toUnix = Math.floor(endTime.toSeconds());

    let candles: Candle[];

    if (interval === '1s') {
      // For 1s, use Birdeye client directly
      const birdeyeClient = getBirdeyeClient();
      const response = await birdeyeClient.fetchOHLCVData(
        MINT_ADDRESS,
        startTime.toJSDate(),
        endTime.toJSDate(),
        '1s',
        chain
      );

      if (!response || !response.items) {
        candles = [];
      } else {
        candles = response.items.map((item) => ({
          timestamp: item.unixTime,
          open: item.open,
          high: item.high,
          low: item.low,
          close: item.close,
          volume: item.volume,
        }));
      }
    } else {
      // For other intervals, use fetchBirdeyeCandles (handles chunking)
      candles = await fetchBirdeyeCandles(MINT_ADDRESS, interval, fromUnix, toUnix, chain);
    }

    if (candles.length === 0) {
      console.log(`   ⚠️  No candles found`);
      return 0;
    }

    console.log(`   ✅ Fetched ${candles.length} candles`);

    // Store candles
    await storage.storeCandles(MINT_ADDRESS, chain, candles, interval);
    console.log(`   💾 Stored ${candles.length} candles in ClickHouse`);

    return candles.length;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`   ❌ Error: ${errorMsg}`);
    logger.error(`Failed to fetch ${interval} candles`, error as Error);
    return 0;
  }
}

async function main() {
  try {
    // 1. Fetch 1s candles: 50,000 candles from launch
    // 50,000 seconds = ~13.9 hours
    const endTime1s = launchDate.plus({ seconds: 50000 });
    const count1s = await fetchAndStore(
      '1s',
      launchDate,
      endTime1s,
      '1s candles (50,000 candles from launch)'
    );

    // 2. Fetch 1m candles: from launch to now
    const count1m = await fetchAndStore('1m', launchDate, now, '1m candles (from launch to now)');

    // 3. Fetch 5m candles: from launch to now
    const count5m = await fetchAndStore('5m', launchDate, now, '5m candles (from launch to now)');

    console.log('\n✅ Complete!');
    console.log(`   1s candles: ${count1s}`);
    console.log(`   1m candles: ${count1m}`);
    console.log(`   5m candles: ${count5m}`);
  } catch (error) {
    console.error('Fatal error:', error);
    logger.error('Fatal error in fetch-specific-mint script', error as Error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
