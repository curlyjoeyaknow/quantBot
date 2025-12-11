#!/usr/bin/env ts-node
/**
 * Backfill alert_price in PostgreSQL by fetching prices from candles at alert timestamp
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { DateTime } from 'luxon';
import { fetchHybridCandles } from '../packages/simulation/src/candles';
import { logger } from '../packages/utils/src/logger';

const pgPool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'quantbot',
  password: process.env.POSTGRES_PASSWORD || '',
  database: process.env.POSTGRES_DATABASE || 'quantbot',
});

/**
 * Get price at a specific timestamp from candles
 */
async function getPriceAtTimestamp(
  tokenAddress: string,
  chain: string,
  timestamp: DateTime
): Promise<number | null> {
  try {
    // Fetch candles around the alert time (1 hour window before and after)
    const startTime = timestamp.minus({ hours: 1 });
    const endTime = timestamp.plus({ hours: 1 });

    const candles = await fetchHybridCandles(
      tokenAddress,
      startTime,
      endTime,
      chain,
      timestamp
    );

    if (candles.length === 0) {
      return null;
    }

    // Find the candle closest to the alert timestamp
    const targetTimestamp = Math.floor(timestamp.toSeconds());
    let closestCandle = candles[0];
    let minDiff = Math.abs(closestCandle.timestamp - targetTimestamp);

    for (const candle of candles) {
      const diff = Math.abs(candle.timestamp - targetTimestamp);
      if (diff < minDiff) {
        minDiff = diff;
        closestCandle = candle;
      }
    }

    // Use close price (or open if close is not available)
    // Close price represents the price at the end of the candle period
    return closestCandle.close || closestCandle.open || null;
  } catch (error: any) {
    logger.warn('Failed to fetch price from candles', {
      token: tokenAddress.substring(0, 12),
      error: error.message,
    });
    return null;
  }
}

/**
 * Process a single alert to backfill its price
 */
async function processAlert(alert: any, stats: {
  processed: number;
  success: number;
  failed: number;
  skipped: number;
}): Promise<void> {
  stats.processed++;

  const { id, token_address, chain, alert_timestamp } = alert;
  const tokenShort = token_address.substring(0, 12);

  try {
    const alertTime = DateTime.fromJSDate(new Date(alert_timestamp));
    
    // Fetch price from candles
    const price = await getPriceAtTimestamp(token_address, chain, alertTime);

    if (!price || price <= 0 || !isFinite(price)) {
      console.log(`⏭️  [${stats.processed}] Alert ${id} (${tokenShort}...): No price found`);
      stats.skipped++;
      return;
    }

    // Update alert_price in database
    await pgPool.query(
      `UPDATE alerts SET alert_price = $1 WHERE id = $2`,
      [price, id]
    );

    console.log(`✅ [${stats.processed}] Alert ${id} (${tokenShort}...): $${price.toFixed(8)}`);
    stats.success++;

    // Small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 150));
  } catch (error: any) {
    console.error(`❌ [${stats.processed}] Alert ${id} (${tokenShort}...): ${error.message}`);
    stats.failed++;
  }
}

/**
 * Main backfill process
 */
async function backfillAlertPrices(): Promise<void> {
  console.log('🚀 Starting alert_price backfill...\n');
  console.log('='.repeat(60));

  // Get alerts without prices
  const result = await pgPool.query(`
    SELECT 
      a.id,
      a.alert_timestamp,
      t.address as token_address,
      t.chain
    FROM alerts a
    JOIN tokens t ON t.id = a.token_id
    WHERE a.alert_price IS NULL
    ORDER BY a.alert_timestamp DESC
    LIMIT 3000
  `);

  console.log(`\n📊 Found ${result.rows.length} alerts without prices\n`);

  if (result.rows.length === 0) {
    console.log('✅ All alerts already have prices!');
    await pgPool.end();
    return;
  }

  const stats = {
    processed: 0,
    success: 0,
    failed: 0,
    skipped: 0,
  };

  const startTime = Date.now();

  for (const alert of result.rows) {
    await processAlert(alert, stats);

    // Progress update every 10 alerts
    if (stats.processed % 10 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = (stats.processed / (Date.now() - startTime) * 1000).toFixed(1);
      console.log(`\n📈 Progress: ${stats.processed}/${result.rows.length} (${rate}/s, ${elapsed}s elapsed)`);
      console.log(`   ✅ Success: ${stats.success} | ⏭️  Skipped: ${stats.skipped} | ❌ Failed: ${stats.failed}\n`);
    }
  }

  // Final report
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n' + '='.repeat(60));
  console.log('\n✅ Backfill Complete!\n');
  console.log('📊 Results:');
  console.log(`  ✅ Success:              ${stats.success}`);
  console.log(`  ⏭️  Skipped (no price):  ${stats.skipped}`);
  console.log(`  ❌ Failed:               ${stats.failed}`);
  console.log(`  📊 Total processed:      ${stats.processed}`);
  console.log(`\n⏱️  Total time: ${totalTime}s`);

  await pgPool.end();
  console.log('\n✨ Done!\n');
}

// Run if called directly
if (require.main === module) {
  backfillAlertPrices()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('\n❌ Fatal error:', error);
      process.exit(1);
    });
}

export { backfillAlertPrices };

