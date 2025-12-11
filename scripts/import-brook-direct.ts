#!/usr/bin/env ts-node
/**
 * Direct Import without init (to avoid table recreation)
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { createClient } from '@clickhouse/client';
import { DateTime } from 'luxon';

const OHLCV_DIR = path.join(process.cwd(), 'data', 'raw', 'brook_ohlcv');
const CLICKHOUSE_HOST = process.env.CLICKHOUSE_HOST || 'localhost';
const CLICKHOUSE_PORT = process.env.CLICKHOUSE_PORT ? parseInt(process.env.CLICKHOUSE_PORT) : 18123;

const client = createClient({
  url: `http://${CLICKHOUSE_HOST}:${CLICKHOUSE_PORT}`,
  database: 'quantbot',
});

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function parseFilename(filename: string): { symbol: string; address: string; chain: string } | null {
  const basename = path.basename(filename, '.csv');
  const parts = basename.split('_');
  
  if (parts.length < 3) return null;
  
  return {
    chain: parts[parts.length - 1],
    address: parts[parts.length - 2],
    symbol: parts.slice(0, -2).join('_'),
  };
}

function loadCandlesFromCSV(filePath: string): Candle[] {
  const csvContent = fs.readFileSync(filePath, 'utf8');
  const records = parse(csvContent, { columns: true, skip_empty_lines: true });
  
  return records.map((r: any) => ({
    timestamp: Math.floor(parseInt(r.Timestamp) / 1000),
    open: parseFloat(r.Open) || 0,
    high: parseFloat(r.High) || 0,
    low: parseFloat(r.Low) || 0,
    close: parseFloat(r.Close) || 0,
    volume: parseFloat(r.Volume) || 0,
  })).filter((c: Candle) => !isNaN(c.timestamp) && c.timestamp > 0);
}

async function main() {
  console.log('🔄 Direct import to ClickHouse...\n');
  
  const files = fs.readdirSync(OHLCV_DIR).filter(f => f.endsWith('.csv'));
  console.log(`📂 Found ${files.length} CSV files\n`);
  
  let migrated = 0;
  let totalCandles = 0;
  
  for (let i = 0; i < files.length; i++) {
    const filename = files[i];
    const info = parseFilename(filename);
    
    if (!info) continue;
    
    process.stdout.write(`[${i+1}/${files.length}] ${info.symbol}... `);
    
    try {
      const candles = loadCandlesFromCSV(path.join(OHLCV_DIR, filename));
      
      if (candles.length === 0) {
        console.log('⚠️  Empty');
        continue;
      }
      
      const rows = candles.map(c => ({
        token_address: info.address,
        chain: info.chain,
        timestamp: DateTime.fromSeconds(c.timestamp).toFormat('yyyy-MM-dd HH:mm:ss'),
        interval: '5m',
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }));
      
      await client.insert({
        table: 'quantbot.ohlcv_candles',
        values: rows,
        format: 'JSONEachRow',
      });
      
      console.log(`✅ ${candles.length.toLocaleString()} candles`);
      migrated++;
      totalCandles += candles.length;
    } catch (error: any) {
      console.log(`❌ ${error.message.substring(0, 50)}`);
    }
  }
  
  console.log(`\n📊 Summary: ${migrated}/${files.length} files, ${totalCandles.toLocaleString()} total candles`);
  await client.close();
}

main();

