#!/usr/bin/env ts-node
/**
 * Check ClickHouse for actual OHLCV data availability
 */

import 'dotenv/config';
import { createClient } from '@clickhouse/client';
import { Pool } from 'pg';

const clickhouseUrl = process.env.CLICKHOUSE_URL || 
  `http://${process.env.CLICKHOUSE_USER || 'default'}:${process.env.CLICKHOUSE_PASSWORD || ''}@${process.env.CLICKHOUSE_HOST || 'localhost'}:${process.env.CLICKHOUSE_PORT || '8123'}/${process.env.CLICKHOUSE_DATABASE || 'quantbot'}`;

const clickhouse = createClient({
  url: clickhouseUrl,
});

const pgPool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'quantbot',
  password: process.env.POSTGRES_PASSWORD || '',
  database: process.env.POSTGRES_DATABASE || 'quantbot',
});

async function checkOHLCVData() {
  console.log('🔍 Checking ClickHouse OHLCV data availability...\n');

  // Get sample tokens from PostgreSQL simulation results
  const pgResult = await pgPool.query(`
    SELECT DISTINCT ON (token_address) token_address, created_at
    FROM simulation_results
    ORDER BY token_address, created_at DESC
    LIMIT 20
  `);

  const tokens = pgResult.rows;
  console.log(`📊 Checking ${tokens.length} tokens...\n`);

  let totalChecked = 0;
  let withData = 0;
  let withoutData = 0;

  for (const row of tokens as any[]) {
    const tokenAddress = row.token_address;
    const escapedTokenAddress = tokenAddress.replace(/'/g, "''");
    
    // Check if we have any candles for this token
    const candleResult = await clickhouse.query({
      query: `
        SELECT 
          COUNT(*) as candle_count,
          MIN(toUnixTimestamp(timestamp)) as earliest_candle,
          MAX(toUnixTimestamp(timestamp)) as latest_candle,
          MAX(toUnixTimestamp(timestamp)) - MIN(toUnixTimestamp(timestamp)) as time_span_seconds
        FROM ohlcv_candles
        WHERE token_address = '${escapedTokenAddress}' AND \`interval\` = '5m'
      `,
      format: 'JSONEachRow',
    });

    const candleData = await candleResult.json();
    const data = (candleData as any[])[0];
    
    totalChecked++;
    if (parseInt(data.candle_count) > 0) {
      withData++;
      const earliest = new Date(parseInt(data.earliest_candle) * 1000);
      const latest = new Date(parseInt(data.latest_candle) * 1000);
      const spanHours = (parseInt(data.latest_candle) - parseInt(data.earliest_candle)) / 3600;
      
      if (withData <= 5) {
        console.log(`✅ ${tokenAddress.substring(0, 12)}...: ${data.candle_count} candles, span: ${spanHours.toFixed(1)} hours`);
        console.log(`   Earliest: ${earliest.toISOString()}, Latest: ${latest.toISOString()}`);
      }
    } else {
      withoutData++;
      if (withoutData <= 5) {
        console.log(`❌ ${tokenAddress.substring(0, 12)}...: No candles in ClickHouse`);
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('\n📊 Summary:');
  console.log(`  ✅ Tokens with OHLCV data: ${withData} (${((withData / totalChecked) * 100).toFixed(1)}%)`);
  console.log(`  ❌ Tokens without OHLCV data: ${withoutData} (${((withoutData / totalChecked) * 100).toFixed(1)}%)`);

  // Check for alerts with sufficient historical data
  console.log('\n🔍 Checking alerts with sufficient historical data...');
  const alertPgResult = await pgPool.query(`
    SELECT DISTINCT ON (sr.token_address, a.alert_timestamp) 
      sr.token_address, 
      a.alert_timestamp,
      sr.created_at
    FROM simulation_results sr
    JOIN alerts a ON a.id = sr.alert_id
    ORDER BY sr.token_address, a.alert_timestamp, sr.created_at DESC
    LIMIT 50
  `);

  const alertsWithData: any[] = [];
  for (const alert of alertPgResult.rows) {
    const alertUnix = Math.floor(new Date(alert.alert_timestamp).getTime() / 1000);
    const escapedTokenAddress = alert.token_address.replace(/'/g, "''");
    const candleResult = await clickhouse.query({
      query: `
        SELECT 
          COUNT(*) as candles_before_alert,
          MIN(toUnixTimestamp(timestamp)) as earliest_candle
        FROM ohlcv_candles
        WHERE token_address = '${escapedTokenAddress}' 
          AND \`interval\` = '5m'
          AND toUnixTimestamp(timestamp) < ${alertUnix}
      `,
      format: 'JSONEachRow',
    });

    const candleData = await candleResult.json();
    const data = (candleData as any[])[0];
    const count = parseInt(data.candles_before_alert);
    
    if (count >= 52) {
      const secondsBefore = alertUnix - parseInt(data.earliest_candle);
      alertsWithData.push({
        token_address: alert.token_address,
        candles_before_alert: count,
        seconds_before_alert: secondsBefore,
      });
    }
  }

  alertsWithData.sort((a, b) => b.candles_before_alert - a.candles_before_alert);
  console.log(`\n✅ Found ${alertsWithData.length} alerts with ≥52 historical candles:`);
  alertsWithData.slice(0, 5).forEach((alert: any) => {
    const hoursBefore = alert.seconds_before_alert / 3600;
    console.log(`  ${alert.token_address.substring(0, 12)}...: ${alert.candles_before_alert} candles (${hoursBefore.toFixed(1)} hours before alert)`);
  });

  await clickhouse.close();
  await pgPool.end();
}

if (require.main === module) {
  checkOHLCVData()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('\n❌ Fatal error:', error);
      process.exit(1);
    });
}

export { checkOHLCVData };

