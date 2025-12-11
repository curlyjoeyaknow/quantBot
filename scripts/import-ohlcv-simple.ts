#!/usr/bin/env tsx
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { createClient } from '@clickhouse/client';
import { DateTime } from 'luxon';

const DIR = path.join(process.cwd(), 'data', 'raw', 'brook_ohlcv');
const client = createClient({
  url: `http://${process.env.CLICKHOUSE_HOST || 'localhost'}:${process.env.CLICKHOUSE_PORT || 18123}`,
  database: 'quantbot',
});

async function main() {
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.csv'));
  console.log(`Importing ${files.length} files...\n`);
  
  let total = 0;
  
  for (const file of files) {
    const parts = path.basename(file, '.csv').split('_');
    const chain = parts[parts.length - 1];
    const address = parts[parts.length - 2];
    
    const csv = fs.readFileSync(path.join(DIR, file), 'utf8');
    const records = parse(csv, { columns: true, skip_empty_lines: true });
    
    const rows = records.map((r: any) => ({
      token_address: address,
      chain,
      timestamp: DateTime.fromMillis(parseInt(r.Timestamp)).toFormat('yyyy-MM-dd HH:mm:ss'),
      interval: '5m',
      open: parseFloat(r.Open),
      high: parseFloat(r.High),
      low: parseFloat(r.Low),
      close: parseFloat(r.Close),
      volume: parseFloat(r.Volume) || 0,
    }));
    
    try {
      await client.insert({
        table: 'ohlcv_candles',
        values: rows,
        format: 'JSONEachRow',
      });
      
      console.log(`✅ ${file.substring(0, 30)}: ${rows.length} candles`);
      total += rows.length;
    } catch (error: any) {
      console.log(`❌ ${file}: ${error.message}`);
      throw error; // Stop on first error to see what's wrong
    }
  }
  
  console.log(`\n✅ Total: ${total.toLocaleString()} candles`);
  await client.close();
}

main();

