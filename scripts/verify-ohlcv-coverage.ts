#!/usr/bin/env ts-node
/**
 * Verify OHLCV data coverage for simulation results
 * Checks if each alert has 52 periods of historical data before alert time
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { DateTime } from 'luxon';
import { fetchHybridCandles } from '../packages/simulation/src/candles';

const pgPool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'quantbot',
  password: process.env.POSTGRES_PASSWORD || '',
  database: process.env.POSTGRES_DATABASE || 'quantbot',
});

async function verifyOHLCVCoverage() {
  console.log('🔍 Verifying OHLCV data coverage for simulation results...\n');

  // Get all simulation results
  const result = await pgPool.query(`
    SELECT 
      sr.alert_id,
      sr.token_address,
      sr.chain,
      a.alert_timestamp,
      COUNT(*) as total_candles_needed
    FROM simulation_results sr
    JOIN alerts a ON a.id = sr.alert_id
    GROUP BY sr.alert_id, sr.token_address, sr.chain, a.alert_timestamp
    ORDER BY a.alert_timestamp DESC
    LIMIT 100
  `);

  console.log(`📊 Checking ${result.rows.length} simulation results...\n`);

  let sufficient = 0;
  let insufficient = 0;
  let errors = 0;

  for (const row of result.rows) {
    try {
      const alertTime = DateTime.fromJSDate(new Date(row.alert_timestamp));
      const startTime = alertTime.minus({ minutes: 52 * 5 }); // 52 periods before
      const endTime = alertTime.plus({ days: 7 });

      // Fetch candles
      const candles = await fetchHybridCandles(
        row.token_address,
        startTime,
        endTime,
        row.chain,
        alertTime
      );

      // Check historical candles (before alert time)
      const alertUnix = Math.floor(alertTime.toSeconds());
      const historicalCandles = candles.filter(c => c.timestamp < alertUnix);
      const historical5m = candles.filter(c => c.timestamp < alertUnix && (c.timestamp % 300 === 0 || true)); // Approximate 5m check

      if (historicalCandles.length >= 52) {
        sufficient++;
        if (sufficient % 10 === 0) {
          console.log(`✅ ${sufficient} alerts with sufficient data (latest: ${row.token_address.substring(0, 8)}...)`);
        }
      } else {
        insufficient++;
        console.log(`⚠️  Alert ${row.alert_id}: Only ${historicalCandles.length} historical candles (need 52)`);
      }

      // Small delay
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error: any) {
      errors++;
      console.error(`❌ Error checking alert ${row.alert_id}:`, error.message);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('\n📊 Coverage Summary:');
  console.log(`  ✅ Sufficient (≥52 periods): ${sufficient}`);
  console.log(`  ⚠️  Insufficient (<52 periods): ${insufficient}`);
  console.log(`  ❌ Errors: ${errors}`);
  console.log(`  📊 Total checked: ${result.rows.length}`);

  const coverageRate = ((sufficient / result.rows.length) * 100).toFixed(1);
  console.log(`\n📈 Coverage rate: ${coverageRate}%`);

  await pgPool.end();
}

if (require.main === module) {
  verifyOHLCVCoverage()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('\n❌ Fatal error:', error);
      process.exit(1);
    });
}

export { verifyOHLCVCoverage };


