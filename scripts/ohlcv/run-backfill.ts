#!/usr/bin/env npx ts-node --transpile-only
/**
 * OHLCV Backfill Script
 * =====================
 * Backfills 1m and 5m OHLCV data for alerts with proper 52-period lookback.
 * Stores to ClickHouse using the standard storage methods.
 *
 * Usage:
 *   pnpm run ohlcv:backfill                    # Backfill first 100 alerts
 *   pnpm run ohlcv:backfill -- --limit 500     # Backfill 500 alerts
 *   pnpm run ohlcv:backfill -- --dry-run       # Dry run (no API calls)
 */

import { config } from 'dotenv';
config();

import { DateTime } from 'luxon';

// Use source imports to avoid build issues
import {
  queryPostgres,
  closePostgresPool,
} from '../../packages/storage/src/postgres/postgres-client';
import { getStorageEngine } from '../../packages/storage/src/engine/StorageEngine';
import { initClickHouse } from '../../packages/storage/src/clickhouse-client';
import { birdeyeClient } from '../../packages/api-clients/src/birdeye-client';
import { logger } from '../../packages/utils/src/logger';

interface AlertToBackfill {
  id: number;
  tokenAddress: string;
  tokenSymbol: string | null;
  chain: string;
  alertTimestamp: Date;
}

interface BackfillProgress {
  total: number;
  processed: number;
  success: number;
  failed: number;
  total1mCandles: number;
  total5mCandles: number;
}

/**
 * Fetch candles from Birdeye API
 */
async function fetchBirdeyeCandles(
  mint: string,
  interval: '1m' | '5m',
  startTime: DateTime,
  endTime: DateTime
): Promise<
  Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>
> {
  try {
    const data = await birdeyeClient.fetchOHLCVData(
      mint,
      startTime.toJSDate(),
      endTime.toJSDate(),
      interval
    );

    if (!data || !data.items || data.items.length === 0) {
      return [];
    }

    return data.items
      .map((item: any) => ({
        timestamp: item.unixTime,
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
        volume: item.volume,
      }))
      .sort((a: any, b: any) => a.timestamp - b.timestamp);
  } catch (error: any) {
    logger.warn(`Failed to fetch ${interval} candles for ${mint}...`, {
      error: error.message,
    });
    return [];
  }
}

/**
 * Backfill a single alert
 *
 * Fetches 4 API calls per token:
 * - 2x 1m: 52 min lookback + ~7 days forward (2 x 5000 = 10,000 candles)
 * - 2x 5m: 260 min lookback + ~34 days forward (2 x 5000 = 10,000 candles)
 */
async function backfillAlert(
  alert: AlertToBackfill,
  storage: ReturnType<typeof getStorageEngine>,
  dryRun: boolean
): Promise<{ success: boolean; candles1m: number; candles5m: number }> {
  const alertTime = DateTime.fromJSDate(alert.alertTimestamp);

  // 1m candles: 2 chunks of 5000 each
  // Chunk 1: -52 min → +5000 min (~3.5 days)
  // Chunk 2: +5000 min → +10000 min (~7 days total)
  const start1m_c1 = alertTime.minus({ minutes: 52 });
  const end1m_c1 = start1m_c1.plus({ minutes: 5000 });
  const start1m_c2 = end1m_c1;
  const end1m_c2 = start1m_c2.plus({ minutes: 5000 });

  // 5m candles: 2 chunks of 5000 each
  // Chunk 1: -260 min → +25000 min (~17 days)
  // Chunk 2: +25000 min → +50000 min (~34 days total)
  const start5m_c1 = alertTime.minus({ minutes: 260 });
  const end5m_c1 = start5m_c1.plus({ minutes: 5000 * 5 });
  const start5m_c2 = end5m_c1;
  const end5m_c2 = start5m_c2.plus({ minutes: 5000 * 5 });

  if (dryRun) {
    console.log(
      `   DRY: ${alert.tokenAddress}... (${alert.tokenSymbol || 'unknown'})`
    );
    return { success: true, candles1m: 0, candles5m: 0 };
  }

  let candles1m = 0;
  let candles5m = 0;

  try {
    // 1m chunk 1
    const data1m_c1 = await fetchBirdeyeCandles(alert.tokenAddress, '1m', start1m_c1, end1m_c1);
    if (data1m_c1.length > 0) {
      await storage.storeCandles(alert.tokenAddress, alert.chain, data1m_c1, '1m');
      candles1m += data1m_c1.length;
    }
    await new Promise((r) => setTimeout(r, 50));

    // 1m chunk 2
    const data1m_c2 = await fetchBirdeyeCandles(alert.tokenAddress, '1m', start1m_c2, end1m_c2);
    if (data1m_c2.length > 0) {
      await storage.storeCandles(alert.tokenAddress, alert.chain, data1m_c2, '1m');
      candles1m += data1m_c2.length;
    }
    await new Promise((r) => setTimeout(r, 50));

    // 5m chunk 1
    const data5m_c1 = await fetchBirdeyeCandles(alert.tokenAddress, '5m', start5m_c1, end5m_c1);
    if (data5m_c1.length > 0) {
      await storage.storeCandles(alert.tokenAddress, alert.chain, data5m_c1, '5m');
      candles5m += data5m_c1.length;
    }
    await new Promise((r) => setTimeout(r, 50));

    // 5m chunk 2
    const data5m_c2 = await fetchBirdeyeCandles(alert.tokenAddress, '5m', start5m_c2, end5m_c2);
    if (data5m_c2.length > 0) {
      await storage.storeCandles(alert.tokenAddress, alert.chain, data5m_c2, '5m');
      candles5m += data5m_c2.length;
    }

    logger.info(`Backfilled ${alert.tokenAddress}...`, {
      '1m': candles1m,
      '5m': candles5m,
    });

    return { success: true, candles1m, candles5m };
  } catch (error: any) {
    logger.error(`Failed to backfill ${alert.tokenAddress}...`, error);
    return { success: false, candles1m, candles5m };
  }
}

async function main() {
  const args = process.argv.slice(2);

  const dryRun = args.includes('--dry-run');
  const limitIndex = args.findIndex((a) => a === '--limit');
  const limit = limitIndex >= 0 && args[limitIndex + 1] ? parseInt(args[limitIndex + 1], 10) : 100;
  const offsetIndex = args.findIndex((a) => a === '--offset');
  const offset =
    offsetIndex >= 0 && args[offsetIndex + 1] ? parseInt(args[offsetIndex + 1], 10) : 0;

  console.log('🔄 OHLCV Backfill Service');
  console.log('─'.repeat(50));
  console.log(`   Limit: ${limit} alerts`);
  console.log(`   Offset: ${offset}`);
  console.log(`   Dry run: ${dryRun}`);
  console.log('─'.repeat(50));

  // Initialize ClickHouse
  if (!dryRun) {
    console.log('📦 Initializing ClickHouse...');
    await initClickHouse();
  }

  const storage = getStorageEngine();

  // Get alerts to backfill
  console.log('📋 Fetching alerts from Postgres...');
  const result = await queryPostgres<{
    id: number;
    token_address: string;
    token_symbol: string | null;
    chain: string;
    alert_timestamp: Date;
  }>(
    `
    SELECT 
      a.id,
      t.address as token_address,
      t.symbol as token_symbol,
      t.chain,
      a.alert_timestamp
    FROM alerts a
    JOIN tokens t ON a.token_id = t.id
    WHERE t.chain = 'solana'
    ORDER BY a.alert_timestamp DESC
    LIMIT $1 OFFSET $2
  `,
    [limit, offset]
  );

  const alerts: AlertToBackfill[] = result.rows.map(
    (row: {
      id: number;
      token_address: string;
      token_symbol: string | null;
      chain: string;
      alert_timestamp: Date;
    }) => ({
      id: row.id,
      tokenAddress: row.token_address,
      tokenSymbol: row.token_symbol,
      chain: row.chain,
      alertTimestamp: row.alert_timestamp,
    })
  );

  console.log(`   Found ${alerts.length} alerts to backfill\n`);

  const progress: BackfillProgress = {
    total: alerts.length,
    processed: 0,
    success: 0,
    failed: 0,
    total1mCandles: 0,
    total5mCandles: 0,
  };

  const startTime = Date.now();

  for (const alert of alerts) {
    const result = await backfillAlert(alert, storage, dryRun);

    progress.processed++;
    if (result.success) {
      progress.success++;
      progress.total1mCandles += result.candles1m;
      progress.total5mCandles += result.candles5m;
    } else {
      progress.failed++;
    }

    // Progress update
    process.stdout.write(
      `\r   Progress: ${progress.processed}/${progress.total} | ✅ ${progress.success} | ❌ ${progress.failed} | 1m: ${progress.total1mCandles} | 5m: ${progress.total5mCandles}`
    );

    // Rate limiting (200ms between tokens)
    if (!dryRun) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  console.log('\n\n' + '─'.repeat(50));
  console.log('✅ BACKFILL COMPLETE');
  console.log('─'.repeat(50));
  console.log(`   Processed: ${progress.processed}/${progress.total}`);
  console.log(`   Success: ${progress.success}`);
  console.log(`   Failed: ${progress.failed}`);
  console.log(`   1m candles: ${progress.total1mCandles.toLocaleString()}`);
  console.log(`   5m candles: ${progress.total5mCandles.toLocaleString()}`);
  console.log(`   Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log('─'.repeat(50));

  await closePostgresPool();
}

main().catch((e) => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
