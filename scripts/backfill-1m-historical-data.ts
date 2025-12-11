#!/usr/bin/env ts-node
/**
 * Backfill historical 1m OHLCV data for all alerts that are missing it
 * Fetches 52 minutes of historical 1m candles before each alert time
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { DateTime } from 'luxon';
import { fetchBirdeyeCandlesDirect } from '../packages/simulation/src/candles';
import { createClient } from '@clickhouse/client';
import type { Candle } from '@quantbot/utils/types/core';

const pgPool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'quantbot',
  password: process.env.POSTGRES_PASSWORD || '',
  database: process.env.POSTGRES_DATABASE || 'quantbot',
});

const clickhouseUrl = process.env.CLICKHOUSE_URL || 
  `http://${process.env.CLICKHOUSE_USER || 'default'}:${process.env.CLICKHOUSE_PASSWORD || ''}@${process.env.CLICKHOUSE_HOST || 'localhost'}:${process.env.CLICKHOUSE_PORT || '8123'}/${process.env.CLICKHOUSE_DATABASE || 'quantbot'}`;

const clickhouse = createClient({
  url: clickhouseUrl,
});

async function checkHistorical1mData(tokenAddress: string, alertUnix: number): Promise<number> {
  const escapedTokenAddress = tokenAddress.replace(/'/g, "''");
  const result = await clickhouse.query({
    query: `
      SELECT COUNT(*) as count
      FROM ohlcv_candles
      WHERE token_address = '${escapedTokenAddress}'
        AND \`interval\` = '1m'
        AND toUnixTimestamp(timestamp) < ${alertUnix}
    `,
    format: 'JSONEachRow',
  });

  const data = await result.json();
  return parseInt((data as any[])[0]?.count || '0');
}

async function backfillHistorical1mData() {
  console.log('═'.repeat(80));
  console.log('🔄 HISTORICAL 1M OHLCV DATA BACKFILL');
  console.log('═'.repeat(80));
  console.log('');

  // Get all unique alerts from simulation results
  console.log('📋 Querying alerts from database...');
  const result = await pgPool.query(`
    SELECT DISTINCT ON (sr.alert_id)
      sr.alert_id,
      sr.token_address,
      sr.chain,
      a.alert_timestamp,
      a.alert_price
    FROM simulation_results sr
    JOIN alerts a ON a.id = sr.alert_id
    WHERE a.alert_price IS NOT NULL
      AND a.alert_price > 0
      AND a.alert_timestamp >= NOW() - INTERVAL '365 days'
    ORDER BY sr.alert_id, sr.created_at DESC
    LIMIT 5000
  `);

  console.log(`✅ Found ${result.rows.length} alerts to process`);
  console.log('');

  let processed = 0;
  let backfilled = 0;
  let skipped = 0;
  let errors = 0;
  const startTime = Date.now();

  console.log('─'.repeat(80));
  console.log('🚀 Starting processing...');
  console.log('─'.repeat(80));
  console.log('');

  for (const row of result.rows) {
    try {
      processed++;
      const alertTime = DateTime.fromJSDate(new Date(row.alert_timestamp));
      const alertUnix = Math.floor(alertTime.toSeconds());
      
      // Progress header every 10 alerts
      if (processed % 10 === 1 || processed === 1) {
        console.log('─'.repeat(80));
        console.log(`📦 BATCH: Alerts ${processed}-${Math.min(processed + 9, result.rows.length)} of ${result.rows.length}`);
        console.log('─'.repeat(80));
      }
      
      console.log(`\n[${processed}/${result.rows.length}] Alert #${row.alert_id}`);
      console.log(`   Token: ${row.token_address.substring(0, 20)}...${row.token_address.slice(-8)}`);
      console.log(`   Chain: ${row.chain}`);
      console.log(`   Alert Time: ${alertTime.toISO()}`);
      console.log(`   Alert Price: $${row.alert_price?.toFixed(8) || 'N/A'}`);
      
      // Check if we already have sufficient historical 1m data (need 52 candles)
      console.log(`   🔍 Checking existing ClickHouse data...`);
      const existingCount = await checkHistorical1mData(row.token_address, alertUnix);
      console.log(`   📊 Existing historical 1m candles: ${existingCount}`);
      
      if (existingCount >= 52) {
        skipped++;
        console.log(`   ✅ SKIP: Already have sufficient data (${existingCount} >= 52 candles)`);
        if (processed % 10 === 0) {
          console.log(`\n   📈 Progress Update: ${processed}/${result.rows.length} | ✅ ${backfilled} backfilled | ⏭️  ${skipped} skipped | ❌ ${errors} errors`);
        }
        continue;
      }

      // Fetch 5000 1m candles starting 52 minutes before alert time
      const CANDLES_BACK = 52; // 52 minutes before alert
      const TOTAL_CANDLES = 5000; // Total candles to fetch
      const CANDLE_1M_SEC = 60;
      
      const oneMStart = alertUnix - (CANDLES_BACK * CANDLE_1M_SEC); // Start 52 minutes before alert
      const oneMEnd = oneMStart + (TOTAL_CANDLES * CANDLE_1M_SEC); // Fetch 5000 candles from start
      
      console.log(`   📥 Fetching 1m candles from Birdeye API...`);
      console.log(`      Start: ${new Date(oneMStart * 1000).toISOString()} (${CANDLES_BACK} min before alert)`);
      console.log(`      End:   ${new Date(oneMEnd * 1000).toISOString()} (${TOTAL_CANDLES} candles total)`);
      console.log(`      Range: ${((oneMEnd - oneMStart) / 3600).toFixed(2)} hours`);

      // Fetch directly from API (bypass ClickHouse cache)
      const fetchStart = Date.now();
      const oneMCandles = await fetchBirdeyeCandlesDirect(
        row.token_address,
        '1m',
        oneMStart,
        oneMEnd,
        row.chain
      );
      const fetchDuration = ((Date.now() - fetchStart) / 1000).toFixed(2);

      const historical1m = oneMCandles.filter((c: Candle) => c.timestamp < alertUnix);
      const future1m = oneMCandles.filter((c: Candle) => c.timestamp >= alertUnix);
      
      console.log(`   ✅ Fetched ${oneMCandles.length} candles in ${fetchDuration}s`);
      console.log(`      Historical (before alert): ${historical1m.length} candles`);
      console.log(`      Future (after alert): ${future1m.length} candles`);
      
      // Store in ClickHouse
      if (oneMCandles.length > 0) {
        console.log(`   💾 Storing in ClickHouse...`);
        try {
          const storeStart = Date.now();
          const { insertCandles } = await import('../packages/storage/src/clickhouse-client');
          await insertCandles(row.token_address, row.chain, oneMCandles, '1m', false);
          const storeDuration = ((Date.now() - storeStart) / 1000).toFixed(2);
          console.log(`   ✅ Stored ${oneMCandles.length} candles in ${storeDuration}s`);
        } catch (error: any) {
          console.error(`   ❌ STORAGE ERROR: ${error.message}`);
          if (error.stack) {
            console.error(`      Stack: ${error.stack.split('\n')[1]?.trim()}`);
          }
        }
      } else {
        console.log(`   ⚠️  No candles to store`);
      }

      if (historical1m.length >= 52) {
        backfilled++;
        console.log(`   ✅ SUCCESS: Backfilled ${historical1m.length} historical candles (need 52)`);
      } else {
        console.log(`   ⚠️  WARNING: Only ${historical1m.length} historical candles (need 52) - insufficient data available`);
      }

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 200));

      // Progress summary every 10 alerts
      if (processed % 10 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const rate = (processed / ((Date.now() - startTime) / 1000)).toFixed(2);
        const remaining = result.rows.length - processed;
        const eta = ((remaining / parseFloat(rate)) / 60).toFixed(1);
        
        console.log('');
        console.log('─'.repeat(80));
        console.log('📊 PROGRESS SUMMARY');
        console.log('─'.repeat(80));
        console.log(`   Processed:  ${processed}/${result.rows.length} (${((processed / result.rows.length) * 100).toFixed(1)}%)`);
        console.log(`   Backfilled: ${backfilled} alerts with sufficient data`);
        console.log(`   Skipped:    ${skipped} alerts (already had data)`);
        console.log(`   Errors:     ${errors} alerts`);
        console.log(`   Rate:       ${rate} alerts/sec`);
        console.log(`   Elapsed:    ${elapsed}s`);
        console.log(`   ETA:        ~${eta} minutes`);
        console.log('─'.repeat(80));
        console.log('');
      }
    } catch (error: any) {
      errors++;
      console.error(`   ❌ ERROR processing alert ${row.alert_id}:`);
      console.error(`      Message: ${error.message}`);
      if (error.stack) {
        console.error(`      Stack: ${error.stack.split('\n').slice(0, 3).join('\n      ')}`);
      }
      // Continue with next alert
    }
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(0);
  const avgRate = (processed / ((Date.now() - startTime) / 1000)).toFixed(2);
  
  console.log('');
  console.log('═'.repeat(80));
  console.log('✅ BACKFILL COMPLETE');
  console.log('═'.repeat(80));
  console.log('');
  console.log('📊 FINAL STATISTICS');
  console.log('─'.repeat(80));
  console.log(`   Total Alerts Processed:  ${processed}`);
  console.log(`   Successfully Backfilled:  ${backfilled} (${((backfilled / processed) * 100).toFixed(1)}%)`);
  console.log(`   Skipped (had data):       ${skipped} (${((skipped / processed) * 100).toFixed(1)}%)`);
  console.log(`   Errors:                   ${errors} (${((errors / processed) * 100).toFixed(1)}%)`);
  console.log('');
  console.log('⏱️  PERFORMANCE');
  console.log('─'.repeat(80));
  console.log(`   Total Duration:           ${totalDuration}s (${(parseFloat(totalDuration) / 60).toFixed(1)} min)`);
  console.log(`   Average Rate:             ${avgRate} alerts/sec`);
  console.log(`   Average Time per Alert:   ${(parseFloat(totalDuration) / processed).toFixed(2)}s`);
  console.log('');
  console.log('═'.repeat(80));

  await clickhouse.close();
  await pgPool.end();
}

if (require.main === module) {
  backfillHistorical1mData()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('\n❌ Fatal error:', error);
      process.exit(1);
    });
}

export { backfillHistorical1mData };

