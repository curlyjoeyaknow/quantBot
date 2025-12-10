#!/usr/bin/env ts-node
/**
 * Identify simulation results that don't have sufficient OHLCV data
 * (52 periods before alert time)
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

async function identifyInsufficientResults() {
  console.log('🔍 Identifying simulation results with insufficient OHLCV data...\n');

  // Get all simulation results
  const result = await pgPool.query(`
    SELECT 
      sr.id,
      sr.alert_id,
      sr.token_address,
      sr.chain,
      a.alert_timestamp
    FROM simulation_results sr
    JOIN alerts a ON a.id = sr.alert_id
    ORDER BY a.alert_timestamp DESC
  `);

  console.log(`📊 Checking ${result.rows.length} simulation results...\n`);

  const insufficient: number[] = [];
  let checked = 0;

  for (const row of result.rows) {
    try {
      const alertTime = DateTime.fromJSDate(new Date(row.alert_timestamp));
      const startTime = alertTime.minus({ minutes: 52 * 5 });
      const endTime = alertTime.plus({ days: 7 });

      const candles = await fetchHybridCandles(
        row.token_address,
        startTime,
        endTime,
        row.chain,
        alertTime
      );

      const alertUnix = Math.floor(alertTime.toSeconds());
      const historicalCandles = candles.filter(c => c.timestamp < alertUnix);

      if (historicalCandles.length < 52) {
        insufficient.push(row.alert_id);
        if (insufficient.length <= 20) {
          console.log(`⚠️  Alert ${row.alert_id}: Only ${historicalCandles.length} historical candles (need 52)`);
        }
      }

      checked++;
      if (checked % 50 === 0) {
        console.log(`📈 Progress: ${checked}/${result.rows.length} (${insufficient.length} insufficient found)`);
      }

      await new Promise(resolve => setTimeout(resolve, 50));
    } catch (error: any) {
      console.error(`❌ Error checking alert ${row.alert_id}:`, error.message);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`\n📊 Results:`);
  console.log(`  ⚠️  Insufficient data: ${insufficient.length} alerts`);
  console.log(`  ✅ Sufficient data: ${result.rows.length - insufficient.length} alerts`);
  console.log(`  📈 Coverage rate: ${((result.rows.length - insufficient.length) / result.rows.length * 100).toFixed(1)}%`);

  if (insufficient.length > 0) {
    console.log(`\n⚠️  Alert IDs with insufficient data (first 50):`);
    console.log(insufficient.slice(0, 50).join(', '));
    
    // Optionally delete these results
    // await pgPool.query(`DELETE FROM simulation_results WHERE alert_id = ANY($1)`, [insufficient]);
  }

  await pgPool.end();
}

if (require.main === module) {
  identifyInsufficientResults()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('\n❌ Fatal error:', error);
      process.exit(1);
    });
}

export { identifyInsufficientResults };

