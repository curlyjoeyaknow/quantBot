#!/usr/bin/env ts-node
/**
 * Verify Ichimoku requirements and 1m OHLCV data availability
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { DateTime } from 'luxon';
import { fetchHybridCandles } from '../packages/simulation/src/candles';
import { calculateIchimoku } from '../packages/simulation/src/ichimoku';

const pgPool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'quantbot',
  password: process.env.POSTGRES_PASSWORD || '',
  database: process.env.POSTGRES_DATABASE || 'quantbot',
});

async function verifyData() {
  console.log('🔍 Verifying Ichimoku requirements and 1m OHLCV data...\n');

  // Get a sample of simulation results
  const result = await pgPool.query(`
    SELECT DISTINCT ON (sr.alert_id)
      sr.alert_id,
      sr.token_address,
      a.alert_timestamp,
      a.alert_price
    FROM simulation_results sr
    JOIN alerts a ON a.id = sr.alert_id
    WHERE a.alert_price IS NOT NULL
    ORDER BY sr.alert_id, sr.created_at DESC
    LIMIT 10
  `);

  console.log(`📊 Analyzing ${result.rows.length} alerts...\n`);

  for (const row of result.rows) {
    try {
      const alertTime = DateTime.fromJSDate(new Date(row.alert_timestamp));
      const startTime = alertTime.minus({ minutes: 52 * 5 }); // 52 periods before
      const endTime = alertTime.plus({ days: 7 });

      console.log(`\n📈 Alert ${row.alert_id} (${row.token_address.substring(0, 12)}...):`);
      console.log(`   Alert time: ${alertTime.toISO()}`);

      // Fetch candles
      const candles = await fetchHybridCandles(
        row.token_address,
        startTime,
        endTime,
        'solana',
        alertTime
      );

      const alertUnix = Math.floor(alertTime.toSeconds());
      
      // Analyze candle types
      const historicalCandles = candles.filter(c => c.timestamp < alertUnix);
      const futureCandles = candles.filter(c => c.timestamp >= alertUnix);
      
      // Try to identify 1m vs 5m candles (1m candles have timestamps divisible by 60, 5m by 300)
      // Actually, we can't easily distinguish after merging, but we know 1m should be more granular
      const totalCandles = candles.length;
      const historicalCount = historicalCandles.length;
      
      console.log(`   Total candles: ${totalCandles}`);
      console.log(`   Historical (before alert): ${historicalCount}`);
      console.log(`   Future (after alert): ${futureCandles.length}`);

      // Check Ichimoku calculation at different candle counts
      if (historicalCount >= 9) {
        // Find the alert candle index
        const alertCandleIndex = candles.findIndex(c => c.timestamp >= alertUnix);
        if (alertCandleIndex >= 0) {
          // Try with available candles
          const ichimoku = calculateIchimoku(candles, alertCandleIndex);
          
          if (ichimoku) {
            console.log(`   ✅ Ichimoku: FULL (all components available)`);
            console.log(`      Tenkan: ${ichimoku.tenkan.toFixed(8)}`);
            console.log(`      Kijun: ${ichimoku.kijun.toFixed(8)}`);
            console.log(`      Senkou A: ${ichimoku.senkouA.toFixed(8)}`);
            console.log(`      Senkou B: ${ichimoku.senkouB.toFixed(8)}`);
          } else {
            console.log(`   ⚠️  Ichimoku: NULL (need ≥52 candles and index ≥51)`);
            
            // Check what we CAN calculate
            if (historicalCount >= 26) {
              console.log(`      Can calculate: Tenkan (9), Kijun (26), Senkou A`);
              console.log(`      Cannot calculate: Senkou B (needs 52), Full cloud`);
            } else if (historicalCount >= 9) {
              console.log(`      Can calculate: Tenkan (9)`);
              console.log(`      Cannot calculate: Kijun (needs 26), Senkou B (needs 52), Full cloud`);
            }
          }
        }
      } else {
        console.log(`   ❌ Insufficient data for Ichimoku (need ≥9 candles, have ${historicalCount})`);
      }

      // Check time span of historical data
      if (historicalCandles.length > 0) {
        const earliest = Math.min(...historicalCandles.map(c => c.timestamp));
        const latest = Math.max(...historicalCandles.map(c => c.timestamp));
        const spanMinutes = (latest - earliest) / 60;
        const minutesBeforeAlert = (alertUnix - latest) / 60;
        console.log(`   Historical span: ${spanMinutes.toFixed(1)} minutes`);
        console.log(`   Minutes before alert: ${minutesBeforeAlert.toFixed(1)}`);
      }

      // Small delay
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error: any) {
      console.error(`   ❌ Error: ${error.message}`);
    }
  }

  await pgPool.end();
}

if (require.main === module) {
  verifyData()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('\n❌ Fatal error:', error);
      process.exit(1);
    });
}

export { verifyData };

