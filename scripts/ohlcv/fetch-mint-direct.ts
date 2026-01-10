#!/usr/bin/env node

/**
 * Script to fetch OHLCV data for a specific mint address using OhlcvFetchJob
 *
 * Usage:
 *   node scripts/ohlcv/fetch-mint-direct.js <mint-address> [launch-date]
 *
 * Example:
 *   node scripts/ohlcv/fetch-mint-direct.js 8wXzwpLjk6QJMYYC1VHueNnxRVW2nFGvQjgEnV4Mv8sY 2024-12-01
 */

import { DateTime } from 'luxon';
import { OhlcvFetchJob } from '@quantbot/jobs';
import { logger } from '@quantbot/utils';

const MINT_ADDRESS = process.argv[2];
const LAUNCH_DATE_STR = process.argv[3] || '2024-12-01';

if (!MINT_ADDRESS) {
  console.error('Usage: node scripts/ohlcv/fetch-mint-direct.js <mint-address> [launch-date]');
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

const chain = 'solana';
const job = new OhlcvFetchJob({
  checkCoverage: false, // Don't skip if data exists
  minCoverageToSkip: 0,
});

async function fetchInterval(
  interval: '1s' | '15s' | '1m' | '5m' | '15m' | '1h',
  startTime: DateTime,
  endTime: DateTime,
  description: string
): Promise<number> {
  console.log(`\n📊 Fetching ${description}...`);
  console.log(`   Interval: ${interval}`);
  console.log(`   From: ${startTime.toISO()}`);
  console.log(`   To: ${endTime.toISO()}`);

  try {
    const result = await job.fetchWorkItem({
      mint: MINT_ADDRESS,
      chain,
      interval,
      startTime,
      endTime,
    });

    if (result.success) {
      console.log(`   ✅ Fetched and stored ${result.candlesStored} candles`);
      return result.candlesStored;
    } else {
      console.log(`   ⚠️  No candles fetched`);
      return 0;
    }
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
    const count1s = await fetchInterval(
      '1s',
      launchDate,
      endTime1s,
      '1s candles (50,000 candles from launch)'
    );

    // 2. Fetch 1m candles: from launch to now
    const count1m = await fetchInterval('1m', launchDate, now, '1m candles (from launch to now)');

    // 3. Fetch 5m candles: from launch to now
    const count5m = await fetchInterval('5m', launchDate, now, '5m candles (from launch to now)');

    console.log('\n✅ Complete!');
    console.log(`   1s candles: ${count1s}`);
    console.log(`   1m candles: ${count1m}`);
    console.log(`   5m candles: ${count5m}`);
  } catch (error) {
    console.error('Fatal error:', error);
    logger.error('Fatal error in fetch-mint-direct script', error as Error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
