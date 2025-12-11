#!/usr/bin/env ts-node
/**
 * Import Brook OHLCV CSV files to ClickHouse
 * Format: Symbol_Address_Chain.csv
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { closeClickHouse } from '@quantbot/storage';
import { createClient } from '@clickhouse/client';
import { DateTime } from 'luxon';
import type { Candle } from '@quantbot/simulation';

const CLICKHOUSE_HOST = process.env.CLICKHOUSE_HOST || 'localhost';
const CLICKHOUSE_PORT = process.env.CLICKHOUSE_PORT ? parseInt(process.env.CLICKHOUSE_PORT) : 18123;
const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

const client = createClient({
  url: `http://${CLICKHOUSE_HOST}:${CLICKHOUSE_PORT}`,
  database: CLICKHOUSE_DATABASE,
});

const OHLCV_DIR = path.join(process.cwd(), 'data', 'raw', 'brook_ohlcv');

interface FileInfo {
  symbol: string;
  address: string;
  chain: string;
}

function parseFilename(filename: string): FileInfo | null {
  // Format: Symbol_Address_Chain.csv
  // Example: DTV_CPLTbYbt_solana.csv
  const basename = path.basename(filename, '.csv');
  const parts = basename.split('_');
  
  if (parts.length < 3) return null;
  
  const chain = parts[parts.length - 1];
  const address = parts[parts.length - 2];
  const symbol = parts.slice(0, -2).join('_');
  
  return { symbol, address, chain };
}

function loadCandlesFromCSV(filePath: string): Candle[] {
  const csvContent = fs.readFileSync(filePath, 'utf8');
  
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
  });
  
  return records.map((record: any) => ({
    timestamp: Math.floor(parseInt(record.Timestamp) / 1000), // Convert ms to seconds
    open: parseFloat(record.Open) || 0,
    high: parseFloat(record.High) || 0,
    low: parseFloat(record.Low) || 0,
    close: parseFloat(record.Close) || 0,
    volume: parseFloat(record.Volume) || 0,
  })).filter((c: Candle) => !isNaN(c.timestamp) && c.timestamp > 0);
}

async function main() {
  console.log('🔄 Importing Brook OHLCV data to ClickHouse...\n');
  
  // DO NOT call initClickHouse() - it recreates tables and wipes data!
  // Table should already exist from initial setup
  
  if (!fs.existsSync(OHLCV_DIR)) {
    console.error(`❌ Directory not found: ${OHLCV_DIR}`);
    await closeClickHouse();
    process.exit(1);
  }
  
  const files = fs.readdirSync(OHLCV_DIR).filter(f => f.endsWith('.csv'));
  console.log(`📂 Found ${files.length} CSV files\n`);
  
  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  let totalCandles = 0;
  
  for (let i = 0; i < files.length; i++) {
    const filename = files[i];
    const fileInfo = parseFilename(filename);
    
    if (!fileInfo) {
      console.log(`[${i+1}/${files.length}] ⚠️  Skipping invalid filename: ${filename}`);
      skipped++;
      continue;
    }
    
    process.stdout.write(`[${i+1}/${files.length}] ${fileInfo.symbol} (${fileInfo.chain})... `);
    
    try {
      const filePath = path.join(OHLCV_DIR, filename);
      const candles = loadCandlesFromCSV(filePath);
      
      if (candles.length === 0) {
        console.log('⚠️  Empty file');
        skipped++;
        continue;
      }
      
      // Insert directly to avoid is_backfill issue
      const rows = candles.map(c => ({
        token_address: fileInfo.address,
        chain: fileInfo.chain,
        timestamp: DateTime.fromSeconds(c.timestamp).toFormat('yyyy-MM-dd HH:mm:ss'),
        interval: '5m',
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }));
      
      await client.insert({
        table: `${CLICKHOUSE_DATABASE}.ohlcv_candles`,
        values: rows,
        format: 'JSONEachRow',
      });
      
      console.log(`✅ Imported ${candles.length.toLocaleString()} candles`);
      migrated++;
      totalCandles += candles.length;
    } catch (error: any) {
      console.log(`❌ Error: ${error.message}`);
      failed++;
    }
  }
  
  console.log(`\n📊 Import Summary:`);
  console.log(`   ✅ Imported: ${migrated} files`);
  console.log(`   ⏭️  Skipped: ${skipped} files`);
  console.log(`   ❌ Failed: ${failed} files`);
  console.log(`   📈 Total candles: ${totalCandles.toLocaleString()}`);
  
  await closeClickHouse();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

