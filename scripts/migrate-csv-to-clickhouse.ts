#!/usr/bin/env ts-node
/**
 * CSV to ClickHouse Migration Script
 * 
 * Migrates existing CSV cache files to ClickHouse for faster queries.
 * This is a one-time migration that can be run incrementally.
 */

// Load environment variables from .env file
import 'dotenv/config';

import * as fs from 'fs';
import * as path from 'path';
import { DateTime } from 'luxon';
import { initClickHouse, insertCandles, closeClickHouse, hasCandles } from '../src/storage/clickhouse-client';
import type { Candle } from '../src/simulation/candles';

const CACHE_DIR = path.join(process.cwd(), 'cache');

interface CacheFileInfo {
  filename: string;
  chain: string;
  tokenAddress: string;
  startTime: DateTime;
  endTime: DateTime;
}

/**
 * Parse cache filename to extract metadata
 */
function parseCacheFilename(filename: string): CacheFileInfo | null {
  // Format: chain_tokenAddress_start_end.csv
  // Example: bsc_0x000Ae314E2A2172a039B26378814C252734f556A_20250921-0322_20251120-0322.csv
  // Extract just the basename if path is included
  const basename = path.basename(filename);
  
  // Split by underscore - we know the format is: chain_tokenAddress_start_end.csv
  // Token addresses can be long, so we need to find the last two date patterns
  const parts = basename.replace('.csv', '').split('_');
  
  if (parts.length < 4) return null;
  
  // The last two parts should be dates (YYYYMMDD-HHMM format)
  const endStr = parts[parts.length - 1];
  const startStr = parts[parts.length - 2];
  
  // Validate date format
  if (!/^\d{8}-\d{4}$/.test(startStr) || !/^\d{8}-\d{4}$/.test(endStr)) {
    return null;
  }
  
  // Chain is the first part
  const chain = parts[0];
  
  // Token address is everything between chain and the first date
  const tokenAddress = parts.slice(1, parts.length - 2).join('_');
  
  // Parse dates - format: YYYYMMDD-HHMM -> YYYY-MM-DD HH:MM:SS
  const startDateStr = `${startStr.substring(0, 4)}-${startStr.substring(4, 6)}-${startStr.substring(6, 8)} ${startStr.substring(9, 11)}:${startStr.substring(11, 13)}:00`;
  const endDateStr = `${endStr.substring(0, 4)}-${endStr.substring(4, 6)}-${endStr.substring(6, 8)} ${endStr.substring(9, 11)}:${endStr.substring(11, 13)}:00`;
  const startTime = DateTime.fromSQL(startDateStr, { zone: 'utc' });
  const endTime = DateTime.fromSQL(endDateStr, { zone: 'utc' });
  
  if (!startTime.isValid || !endTime.isValid) {
    // Debug: log why parsing failed
    if (!startTime.isValid) {
      console.warn(`Failed to parse start date: ${startDateStr}, reason: ${startTime.invalidReason}`);
    }
    if (!endTime.isValid) {
      console.warn(`Failed to parse end date: ${endDateStr}, reason: ${endTime.invalidReason}`);
    }
    return null;
  }
  
  return {
    filename: basename,
    chain,
    tokenAddress,
    startTime,
    endTime,
  };
}

/**
 * Load candles from CSV file
 */
function loadCandlesFromCSV(filePath: string): Candle[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    const candles: Candle[] = [];
    
    // Skip header line (index 0)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue; // Skip empty lines
      
      const parts = line.split(',');
      if (parts.length < 6) {
        console.warn(`Skipping malformed line ${i} in ${filePath}`);
        continue;
      }
      
      const timestamp = parseInt(parts[0], 10);
      const open = parseFloat(parts[1]);
      const high = parseFloat(parts[2]);
      const low = parseFloat(parts[3]);
      const close = parseFloat(parts[4]);
      const volume = parseFloat(parts[5]);
      
      // Validate data
      if (isNaN(timestamp) || isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close) || isNaN(volume)) {
        console.warn(`Skipping invalid data on line ${i} in ${filePath}`);
        continue;
      }
      
      candles.push({
        timestamp,
        open,
        high,
        low,
        close,
        volume,
      });
    }
    
    return candles;
  } catch (error: any) {
    console.error(`Error loading CSV ${filePath}:`, error.message);
    return [];
  }
}

/**
 * Determine interval from candles (5m or 1h)
 */
function detectInterval(candles: Candle[]): string {
  if (candles.length < 2) return '5m';
  
  const timeDiff = candles[1].timestamp - candles[0].timestamp;
  // 5m = 300 seconds, 1h = 3600 seconds
  return timeDiff <= 600 ? '5m' : '1h';
}

async function main() {
  console.log('🔄 Migrating CSV cache to ClickHouse...\n');
  
  // Initialize ClickHouse
  try {
    await initClickHouse();
  } catch (error: any) {
    console.error('❌ Failed to initialize ClickHouse:', error.message);
    console.error('\nMake sure ClickHouse is running and accessible.');
    console.error('Run: docker-compose up -d clickhouse (if using Docker)');
    process.exit(1);
  }
  
  // Get all CSV files
  if (!fs.existsSync(CACHE_DIR)) {
    console.error(`❌ Cache directory not found: ${CACHE_DIR}`);
    process.exit(1);
  }
  
  const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.csv'));
  console.log(`📂 Found ${files.length} CSV cache files\n`);
  
  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  let totalCandles = 0;
  
  for (let i = 0; i < files.length; i++) {
    const filename = files[i];
    const fileInfo = parseCacheFilename(filename);
    
    if (!fileInfo) {
      console.log(`[${i+1}/${files.length}] ⚠️  Skipping invalid filename: ${filename}`);
      skipped++;
      continue;
    }
    
    process.stdout.write(`[${i+1}/${files.length}] Processing ${filename.substring(0, 60)}... `);
    
    try {
      // Load candles from CSV first to check if file has data
      const filePath = path.join(CACHE_DIR, filename);
      const candles = loadCandlesFromCSV(filePath);
      
      if (candles.length === 0) {
        console.log('⚠️  Empty file');
        skipped++;
        continue;
      }
      
      // Check if already migrated (only check if we have candles)
      const exists = await hasCandles(
        fileInfo.tokenAddress,
        fileInfo.chain,
        fileInfo.startTime,
        fileInfo.endTime
      );
      
      if (exists) {
        console.log(`✅ Already in ClickHouse (${candles.length} candles)`);
        skipped++;
        totalCandles += candles.length;
        continue;
      }
      
      // Detect interval
      const interval = detectInterval(candles);
      
      // Insert into ClickHouse in batches to avoid memory issues
      const BATCH_SIZE = 10000;
      for (let j = 0; j < candles.length; j += BATCH_SIZE) {
        const batch = candles.slice(j, j + BATCH_SIZE);
        await insertCandles(fileInfo.tokenAddress, fileInfo.chain, batch, interval);
      }
      
      console.log(`✅ Migrated ${candles.length} candles (${interval})`);
      migrated++;
      totalCandles += candles.length;
    } catch (error: any) {
      console.log(`❌ Error: ${error.message}`);
      failed++;
    }
  }
  
  console.log(`\n📊 Migration Summary:`);
  console.log(`   ✅ Migrated: ${migrated} files`);
  console.log(`   ⏭️  Skipped: ${skipped} files (already in DB or empty)`);
  console.log(`   ❌ Failed: ${failed} files`);
  console.log(`   📈 Total candles: ${totalCandles.toLocaleString()}`);
  
  await closeClickHouse();
}

main();

