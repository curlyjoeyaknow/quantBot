#!/usr/bin/env ts-node
/**
 * Verify ClickHouse connectivity and schema
 */

import 'dotenv/config';
import { createClient } from '@clickhouse/client';

async function main() {
  try {
    console.log('Connecting to ClickHouse...');
    
    const client = createClient({
      host: process.env.CLICKHOUSE_HTTP_URL || `http://${process.env.CLICKHOUSE_HOST || 'localhost'}:${process.env.CLICKHOUSE_HTTP_PORT || '18123'}`,
      database: process.env.CLICKHOUSE_DATABASE || 'quantbot',
      username: process.env.CLICKHOUSE_USER || 'default',
      password: process.env.CLICKHOUSE_PASSWORD || '',
    });
    
    // Test connection with simple query
    const countResult = await client.query({
      query: 'SELECT count() as total FROM ohlcv_candles',
      format: 'JSONEachRow',
    });
    
    const rows = await countResult.json();
    const total = rows[0]?.total || 0;
    console.log(`✓ Total candles in ClickHouse: ${total.toLocaleString()}`);
    
    // Verify schema
    const schemaResult = await client.query({
      query: 'DESCRIBE TABLE ohlcv_candles',
      format: 'JSONEachRow',
    });
    
    const schema = await schemaResult.json();
    const columns = schema.map((row: any) => row.name);
    console.log(`✓ Columns: ${columns.join(', ')}`);
    
    // Check for interval column
    if (columns.includes('interval')) {
      const intervalRow = schema.find((row: any) => row.name === 'interval');
      console.log(`✓ Schema has 'interval' column (type: ${intervalRow.type})`);
    } else if (columns.includes('interval_seconds')) {
      const intervalRow = schema.find((row: any) => row.name === 'interval_seconds');
      console.log(`⚠️  Schema has 'interval_seconds' column (type: ${intervalRow.type})`);
    } else {
      throw new Error('Missing interval column!');
    }
    
    // Get sample data distribution
    const distResult = await client.query({
      query: `
        SELECT 
          chain,
          interval_seconds,
          count() as cnt,
          min(timestamp) as min_ts,
          max(timestamp) as max_ts
        FROM ohlcv_candles
        GROUP BY chain, interval_seconds
        ORDER BY cnt DESC
        LIMIT 10
      `,
      format: 'JSONEachRow',
    });
    
    const dist = await distResult.json();
    console.log('\n✓ Data distribution (top 10):');
    for (const row of dist) {
      const intervalLabel = row.interval_seconds === 60 ? '1m' : 
                           row.interval_seconds === 300 ? '5m' :
                           row.interval_seconds === 15 ? '15s' :
                           row.interval_seconds === 1 ? '1s' :
                           row.interval_seconds === 3600 ? '1h' :
                           `${row.interval_seconds}s`;
      console.log(`  ${row.chain}/${intervalLabel}: ${row.cnt.toLocaleString()} candles (${row.min_ts} to ${row.max_ts})`);
    }
    
    await client.close();
    
    console.log('\n✅ Schema verification: PASSED');
    process.exit(0);
  } catch (error) {
    console.error('❌ Schema verification FAILED:', error);
    process.exit(1);
  }
}

main();
