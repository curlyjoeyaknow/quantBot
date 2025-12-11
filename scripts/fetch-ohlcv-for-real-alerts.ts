#!/usr/bin/env tsx
/**
 * Fetch OHLCV data for tokens with real alerts using existing services
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { OHLCVIngestionService } from '@quantbot/ingestion';
import { insertCandles, initClickHouse, closeClickHouse } from '@quantbot/storage';
import { DateTime } from 'luxon';

const pgPool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'quantbot',
  password: process.env.POSTGRES_PASSWORD || '',
  database: process.env.POSTGRES_DATABASE || 'quantbot',
});

const ohlcvService = new OHLCVIngestionService();

async function main() {
  console.log('🔄 Fetching OHLCV data for tokens with alerts...\n');

  await initClickHouse();

  // Get Solana tokens with alerts that have prices AND valid timestamps
  const result = await pgPool.query(`
    WITH token_alerts AS (
      SELECT 
        t.address,
        t.symbol,
        t.chain,
        MIN(a.alert_timestamp) as first_alert,
        COUNT(*) as alert_count
      FROM tokens t
      JOIN alerts a ON a.token_id = t.id
      WHERE a.alert_price IS NOT NULL
      AND a.alert_price > 0
      AND t.chain = 'solana'
      AND a.alert_timestamp > '2025-01-01'
      GROUP BY t.address, t.symbol, t.chain
    )
    SELECT * FROM token_alerts
    ORDER BY alert_count DESC
    LIMIT 200
  `);

  console.log(`📊 Found ${result.rows.length} tokens to fetch\n`);

  let successCount = 0;
  let totalCandles = 0;
  let failCount = 0;

  for (let i = 0; i < result.rows.length; i++) {
    const token = result.rows[i];
    const symbol = (token.symbol || 'UNKNOWN').substring(0, 20);
    
    // Fetch 5000 1m candles: start 52 minutes BEFORE first alert, fetch forward
    const alertTime = new Date(token.first_alert);
    const startTime = new Date(alertTime.getTime() - (52 * 60 * 1000)); // 52 minutes before
    const endTime = new Date(startTime.getTime() + (5000 * 60 * 1000)); // 5000 minutes forward (~3.5 days)

    process.stdout.write(`[${i + 1}/${result.rows.length}] ${symbol} (${token.alert_count} alerts)... `);

    try {
      // Use existing ingestion service (writes to InfluxDB)
      const result = await ohlcvService.fetchAndStoreOHLCV(
        token.address,
        startTime,
        endTime,
        symbol,
        token.chain
      );

      if (!result.success || result.recordsAdded === 0) {
        console.log('⚠️  No data');
        failCount++;
        continue;
      }

      console.log(`✅ ${result.recordsAdded.toLocaleString()} candles (InfluxDB)`);
      
      successCount++;
      totalCandles += result.recordsAdded;

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 6500));
      
    } catch (error: any) {
      console.log(`❌ ${error.message.substring(0, 50)}`);
      failCount++;
      
      if (error.message.includes('429') || error.message.includes('rate limit')) {
        console.log('⏳ Rate limited, waiting 60s...');
        await new Promise(resolve => setTimeout(resolve, 60000));
      }
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   ✅ Success: ${successCount} tokens`);
  console.log(`   ❌ Failed: ${failCount} tokens`);
  console.log(`   📈 Total candles: ${totalCandles.toLocaleString()}`);
  console.log(`\n⚠️  Note: Data was written to InfluxDB, not ClickHouse`);
  console.log(`   The performance page needs to be updated to use InfluxDB`);

  await pgPool.end();
  await closeClickHouse();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

