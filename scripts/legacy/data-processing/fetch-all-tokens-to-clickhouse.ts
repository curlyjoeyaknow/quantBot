#!/usr/bin/env ts-node
/**
 * Fetch All Tokens to ClickHouse
 * 
 * Fetches OHLCV data for all tokens in the calls CSV directly from Birdeye
 * and stores them in ClickHouse. This ensures comprehensive data coverage
 * for strategy optimization.
 */

// Load environment variables from .env file
import 'dotenv/config';

import { DateTime } from 'luxon';
import { parse } from 'csv-parse';
import * as fs from 'fs';
import * as path from 'path';
import { fetchHybridCandles } from '../src/simulation/candles';
import { initClickHouse, hasCandles } from '../src/storage/clickhouse-client';

const BROOK_CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');
const PROGRESS_FILE = path.join(__dirname, '../data/exports/token-fetch-progress.json');

interface FetchProgress {
  processed: number;
  skipped: number;
  errors: number;
  lastToken?: string;
  tokens: Set<string>;
}

async function loadProgress(): Promise<FetchProgress> {
  if (fs.existsSync(PROGRESS_FILE)) {
    const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    return {
      ...data,
      tokens: new Set(data.tokens || []),
    };
  }
  return {
    processed: 0,
    skipped: 0,
    errors: 0,
    tokens: new Set<string>(),
  };
}

function saveProgress(progress: FetchProgress): void {
  const data = {
    ...progress,
    tokens: Array.from(progress.tokens),
  };
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2));
}

async function fetchAllTokensToClickHouse() {
  console.log('🚀 Fetching All Tokens to ClickHouse\n');
  
  // Initialize ClickHouse
  await initClickHouse();
  console.log('✅ ClickHouse initialized\n');
  
  // Load calls data
  console.log('📂 Loading calls data...');
  const csv = fs.readFileSync(BROOK_CALLS_CSV, 'utf8');
  const records: any[] = await new Promise((resolve, reject) => {
    parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records);
    });
  });
  console.log(`✅ Loaded ${records.length} calls\n`);
  
  // Load progress
  const progress = await loadProgress();
  console.log(`📊 Progress: ${progress.processed} processed, ${progress.skipped} skipped, ${progress.errors} errors\n`);
  
  // Get unique tokens
  const uniqueTokens = new Map<string, { chain: string; timestamp: string }>();
  for (const record of records) {
    const tokenAddress = record.tokenAddress || record.mint;
    const chain = record.chain || 'solana';
    const timestamp = record.timestamp;
    
    if (tokenAddress && timestamp) {
      const key = `${chain}:${tokenAddress.toLowerCase()}`;
      if (!uniqueTokens.has(key)) {
        uniqueTokens.set(key, { chain, timestamp });
      }
    }
  }
  
  console.log(`📊 Found ${uniqueTokens.size} unique tokens\n`);
  console.log('🔄 Starting fetch process...\n');
  
  let processed = progress.processed;
  let skipped = progress.skipped;
  let errors = progress.errors;
  const processedTokens = progress.tokens;
  
  const tokensArray = Array.from(uniqueTokens.entries());
  const startTime = Date.now();
  
  for (let i = 0; i < tokensArray.length; i++) {
    const [key, { chain, timestamp }] = tokensArray[i];
    const [, tokenAddress] = key.split(':');
    
    // Skip if already processed
    if (processedTokens.has(key)) {
      continue;
    }
    
    // Progress update every 10 tokens
    if (i % 10 === 0 || i === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processed / elapsed;
      const remaining = tokensArray.length - i;
      const eta = remaining / rate;
      const displayAddr = tokenAddress.length > 30 ? tokenAddress.substring(0, 30) + '...' : tokenAddress;
      console.log(`[${i + 1}/${tokensArray.length}] Processing ${displayAddr} (${chain})`);
      console.log(`   Progress: ${processed} processed, ${skipped} skipped, ${errors} errors`);
      console.log(`   Rate: ${rate.toFixed(1)} tokens/sec, ETA: ${(eta / 60).toFixed(1)} minutes\n`);
    }
    
    try {
      const alertTime = DateTime.fromISO(timestamp);
      if (!alertTime.isValid) {
        skipped++;
        continue;
      }
      
      // Check if already in ClickHouse
      const endTime = alertTime.plus({ days: 60 });
      const hasData = await hasCandles(tokenAddress, chain, alertTime, endTime);
      
      if (hasData) {
        skipped++;
        processedTokens.add(key);
        continue;
      }
      
      // Fetch candles (will auto-save to ClickHouse)
      const candles = await fetchHybridCandles(tokenAddress, alertTime, endTime, chain);
      
      if (candles.length >= 10) {
        processed++;
        processedTokens.add(key);
        if (i % 10 === 0) {
          const displayAddr = tokenAddress.length > 30 ? tokenAddress.substring(0, 30) + '...' : tokenAddress;
          console.log(`   ✅ Fetched ${candles.length} candles for ${displayAddr}\n`);
        }
      } else if (candles.length > 0) {
        // Some candles but not enough - still save to ClickHouse
        processed++;
        processedTokens.add(key);
        if (i % 10 === 0) {
          const displayAddr = tokenAddress.length > 30 ? tokenAddress.substring(0, 30) + '...' : tokenAddress;
          console.log(`   ⚠️  Limited candles (${candles.length}) - saved anyway\n`);
        }
      } else {
        // No candles - token doesn't exist or has no data (expected for many tokens)
        skipped++;
        processedTokens.add(key); // Mark as processed so we don't retry
        if (i % 10 === 0) {
          const displayAddr = tokenAddress.length > 30 ? tokenAddress.substring(0, 30) + '...' : tokenAddress;
          console.log(`   ⏭️  No data available for ${displayAddr} (skipped)\n`);
        }
      }
      
      // Save progress every 50 tokens
      if (i % 50 === 0) {
        saveProgress({ processed, skipped, errors, tokens: processedTokens });
      }
      
      // Rate limiting: 15 requests per second (900 RPM)
      await new Promise(resolve => setTimeout(resolve, 70));
      
    } catch (error: any) {
      // Only count as error if it's not a "token not found" type error
      const isExpectedError = error.message?.includes('400') || 
                              error.message?.includes('404') ||
                              error.message?.includes('Request failed with status code 400') ||
                              error.message?.includes('Request failed with status code 404');
      
      if (isExpectedError) {
        // Token not found - expected, just skip
        skipped++;
        processedTokens.add(key);
        if (i % 10 === 0) {
          const displayAddr = tokenAddress.length > 30 ? tokenAddress.substring(0, 30) + '...' : tokenAddress;
          console.log(`   ⏭️  Token not found: ${displayAddr} (skipped)\n`);
        }
      } else {
        // Real error (network, 500, etc.)
        errors++;
        if (i % 10 === 0) {
          console.log(`   ❌ Error: ${error.message}\n`);
        }
      }
    }
  }
  
  // Final save
  saveProgress({ processed, skipped, errors, tokens: processedTokens });
  
  console.log('\n✅ Fetch Complete!\n');
  console.log(`📊 Final Stats:`);
  console.log(`   Processed: ${processed}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Errors: ${errors}`);
  console.log(`   Total unique tokens: ${uniqueTokens.size}`);
  console.log(`   Coverage: ${((processed / uniqueTokens.size) * 100).toFixed(1)}%\n`);
}

fetchAllTokensToClickHouse().catch(console.error);

