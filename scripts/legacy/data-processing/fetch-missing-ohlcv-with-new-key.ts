#!/usr/bin/env ts-node
/**
 * Fetch Missing OHLCV Candles with New Birdeye API Key
 * 
 * Identifies tokens that are missing ALL OHLCV data in ClickHouse
 * and tokens from calls after Nov 3rd, then fetches them from Birdeye API.
 */

import 'dotenv/config';

// New Birdeye API key with 3M credits - Override after dotenv loads
const NEW_BIRDEYE_API_KEY = '72f6ae15fb1c4d3f9529405051e4c839';
process.env.BIRDEYE_API_KEY = NEW_BIRDEYE_API_KEY;
process.env.BIRDEYE_API_KEY_1 = NEW_BIRDEYE_API_KEY;

import { DateTime } from 'luxon';
import { parse } from 'csv-parse';
import * as fs from 'fs';
import * as path from 'path';
import { fetchHybridCandles } from '../src/simulation/candles';
import { initClickHouse, hasCandles, closeClickHouse, insertCandles } from '../src/storage/clickhouse-client';

const BROOK_CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');
const NOV_3_2025 = DateTime.fromISO('2025-11-03T00:00:00Z');
const BATCH_SIZE = 50; // Process 50 tokens at a time
const CHECKPOINT_FILE = path.join(__dirname, '../data/fetch-ohlcv-checkpoint.json');

interface TokenInfo {
  tokenAddress: string;
  chain: string;
  timestamp: string;
  caller: string;
  reason: 'missing_all' | 'recent_call';
}

interface Checkpoint {
  lastProcessedIndex: number;
  totalProcessed: number;
  success: number;
  failed: number;
  skipped: number;
  totalCandles: number;
  timestamp: string;
}

async function fetchMissingOHLCV() {
  console.log(`\n${'='.repeat(80)}`);
  console.log('🚀 FETCHING MISSING OHLCV CANDLES WITH NEW BIRDEYE API KEY');
  console.log(`${'='.repeat(80)}\n`);
  console.log(`🔑 Using API key: ${NEW_BIRDEYE_API_KEY.substring(0, 8)}...`);
  console.log(`📅 Fetching for:`);
  console.log(`   - Tokens missing ALL OHLCV data`);
  console.log(`   - Calls after ${NOV_3_2025.toFormat('yyyy-MM-dd')}\n`);

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
  console.log(`✅ Loaded ${records.length} total calls\n`);

  // Filter to Solana only
  console.log('🎯 Filtering to Solana calls only...');
  const solanaCalls = records.filter(record => {
    const chain = (record.chain || 'solana').toLowerCase();
    return chain === 'solana';
  });
  console.log(`✅ Found ${solanaCalls.length} Solana calls\n`);

  // Deduplicate: Only process unique tokens
  console.log('🔍 Deduplicating calls by token address...');
  const uniqueTokens = new Map<string, TokenInfo>();
  for (const record of solanaCalls) {
    const tokenAddress = record.tokenAddress || record.mint;
    const chain = record.chain || 'solana';
    const timestamp = record.timestamp || record.alertTime || '';
    
    if (!tokenAddress || !timestamp) continue;
    
    const key = `${chain}:${tokenAddress.toLowerCase()}`;
    // Use first call for each unique token
    if (!uniqueTokens.has(key)) {
      uniqueTokens.set(key, {
        tokenAddress,
        chain,
        timestamp,
        caller: record.sender || record.caller || '',
        reason: 'missing_all', // Will be updated later
      });
    }
  }
  
  const uniqueCalls = Array.from(uniqueTokens.values());
  console.log(`✅ Deduplicated: ${uniqueCalls.length} unique tokens\n`);

  // Check which tokens are missing ALL candles
  console.log('🔍 Checking which tokens are missing ALL candle data...');
  const tokensToFetch: TokenInfo[] = [];
  
  for (let i = 0; i < uniqueCalls.length; i++) {
    const call = uniqueCalls[i];
    const tokenAddress = call.tokenAddress;
    const chain = call.chain;
    
    if (!tokenAddress) continue;
    
    const alertTime = DateTime.fromISO(call.timestamp);
    if (!alertTime.isValid) {
      if ((i + 1) % 100 === 0) {
        console.log(`   ⏭️  Skipped ${i + 1}/${uniqueCalls.length} tokens... (${tokensToFetch.length} to fetch)`);
      }
      continue;
    }
    
    // Check if this is a recent call (after Nov 3rd)
    const isRecent = alertTime > NOV_3_2025;
    
    // For recent calls, always fetch (even if some data exists, we want latest)
    if (isRecent) {
      tokensToFetch.push({
        ...call,
        reason: 'recent_call',
      });
      if ((i + 1) % 100 === 0) {
        console.log(`   Checked ${i + 1}/${uniqueCalls.length} tokens... (${tokensToFetch.length} to fetch)`);
      }
      continue;
    }
    
    // For older calls, check if they have ANY data
    // Use a wide time range to check if token has any candles at all
    const checkStart = alertTime.minus({ days: 1 });
    const checkEnd = alertTime.plus({ days: 60 });
    
    const hasData = await hasCandles(tokenAddress, chain, checkStart, checkEnd);
    
    if (!hasData) {
      tokensToFetch.push({
        ...call,
        reason: 'missing_all',
      });
    }
    
    if ((i + 1) % 100 === 0) {
      console.log(`   Checked ${i + 1}/${uniqueCalls.length} tokens... (${tokensToFetch.length} to fetch)`);
    }
  }
  
  const missingAll = tokensToFetch.filter(t => t.reason === 'missing_all').length;
  const recentCalls = tokensToFetch.filter(t => t.reason === 'recent_call').length;
  
  // Sort by timestamp (newest first) - prioritize recent calls
  tokensToFetch.sort((a, b) => {
    const timeA = DateTime.fromISO(a.timestamp);
    const timeB = DateTime.fromISO(b.timestamp);
    if (!timeA.isValid) return 1; // Invalid timestamps go to end
    if (!timeB.isValid) return -1;
    return timeB.toMillis() - timeA.toMillis(); // Descending (newest first)
  });
  
  console.log(`\n✅ Found ${tokensToFetch.length} tokens to fetch:`);
  console.log(`   - Missing ALL data: ${missingAll}`);
  console.log(`   - Recent calls (after Nov 3): ${recentCalls}`);
  console.log(`   📅 Sorted by timestamp: NEWEST CALLS FIRST\n`);

  if (tokensToFetch.length === 0) {
    console.log('🎉 No tokens need fetching!\n');
    await closeClickHouse();
    return;
  }

  // Load checkpoint if exists
  let startIndex = 0;
  let success = 0;
  let failed = 0;
  let skipped = 0;
  let totalCandles = 0;
  
  if (fs.existsSync(CHECKPOINT_FILE)) {
    try {
      const checkpoint: Checkpoint = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8'));
      startIndex = checkpoint.lastProcessedIndex + 1;
      success = checkpoint.success;
      failed = checkpoint.failed;
      skipped = checkpoint.skipped;
      totalCandles = checkpoint.totalCandles;
      console.log(`📋 Resuming from checkpoint: ${startIndex}/${tokensToFetch.length} tokens already processed\n`);
    } catch (err) {
      console.log('⚠️  Could not load checkpoint, starting from beginning\n');
    }
  }
  
  // Fetch candles for missing tokens in batches
  console.log(`🔄 Fetching candles for ${tokensToFetch.length} tokens (starting at ${startIndex})...\n`);
  console.log(`📦 Processing in batches of ${BATCH_SIZE} tokens\n`);
  console.log('⚠️  Note: 1 credit per API call. Saving to ClickHouse after each fetch.\n');
  
  // Enable ClickHouse saving
  process.env.USE_CLICKHOUSE = 'true';
  
  const totalBatches = Math.ceil((tokensToFetch.length - startIndex) / BATCH_SIZE);
  let currentBatch = 0;
  
  for (let i = startIndex; i < tokensToFetch.length; i++) {
    const call = tokensToFetch[i];
    const tokenAddress = call.tokenAddress;
    const chain = call.chain;
    const displayAddr = tokenAddress.length > 30 ? tokenAddress.substring(0, 30) + '...' : tokenAddress;
    
    // Check if we're starting a new batch
    const batchNumber = Math.floor((i - startIndex) / BATCH_SIZE);
    if (batchNumber > currentBatch) {
      currentBatch = batchNumber;
      console.log(`\n${'='.repeat(60)}`);
      console.log(`📦 Batch ${currentBatch + 1}/${totalBatches} (tokens ${i}/${tokensToFetch.length})`);
      console.log(`${'='.repeat(60)}\n`);
      
      // Save checkpoint before starting new batch
      await saveCheckpoint(i - 1, success, failed, skipped, totalCandles);
      
      // Small delay between batches
      console.log('⏸️  Pausing 5 seconds between batches...\n');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    // Progress update every token in batch
    const progress = ((i - startIndex + 1) / (tokensToFetch.length - startIndex)) * 100;
    const reason = call.reason === 'missing_all' ? 'missing' : 'recent';
    console.log(`[${i + 1}/${tokensToFetch.length}] (${progress.toFixed(1)}%) [${reason}] ${displayAddr}...`);
    
    try {
      const alertTime = DateTime.fromISO(call.timestamp);
      if (!alertTime.isValid) {
        skipped++;
        console.log(`   ⏭️  Skipped: Invalid timestamp\n`);
        continue;
      }
      
      // For recent calls, fetch from alert time to now
      // For missing data, fetch from alert time to 7 days after
      const endTime = call.reason === 'recent_call' 
        ? DateTime.now()
        : alertTime.plus({ days: 7 });
      
      // Fetch candles from Birdeye (1 credit per call)
      const candles = await fetchHybridCandles(tokenAddress, alertTime, endTime, chain);
      
      if (candles.length > 0) {
        // Explicitly insert to ClickHouse and verify success
        try {
          const interval = candles.length > 1 && (candles[1].timestamp - candles[0].timestamp) <= 600 ? '5m' : '1h';
          await insertCandles(tokenAddress, chain, candles, interval);
          
          success++;
          totalCandles += candles.length;
          console.log(`   ✅ Fetched ${candles.length} candles, saved to ClickHouse\n`);
        } catch (insertError: any) {
          // ClickHouse insert failed - log but don't count as success
          console.log(`   ⚠️  Fetched ${candles.length} candles but ClickHouse insert failed: ${insertError.message}\n`);
          failed++;
          // Don't continue - we lost the data, need to retry
        }
      } else {
        failed++;
        console.log(`   ⚠️  No candles returned (token may not exist or have no data)\n`);
      }
      
      // Rate limiting: ~15 requests per second (70ms delay = ~14 req/sec)
      await new Promise(resolve => setTimeout(resolve, 70));
      
      // Save checkpoint every 10 tokens
      if ((i - startIndex + 1) % 10 === 0) {
        await saveCheckpoint(i, success, failed, skipped, totalCandles);
      }
      
    } catch (error: any) {
      failed++;
      console.log(`   ❌ Error: ${error.message}\n`);
      
      // Save checkpoint on error
      await saveCheckpoint(i, success, failed, skipped, totalCandles);
    }
  }
  
  // Final checkpoint
  await saveCheckpoint(tokensToFetch.length - 1, success, failed, skipped, totalCandles);
  
  await closeClickHouse();
  
  console.log(`\n${'='.repeat(80)}`);
  console.log('✅ FETCH COMPLETE');
  console.log(`${'='.repeat(80)}\n`);
  console.log(`📊 Summary:`);
  console.log(`   Total tokens checked: ${uniqueCalls.length}`);
  console.log(`   Tokens to fetch: ${tokensToFetch.length}`);
  console.log(`     - Missing ALL data: ${missingAll}`);
  console.log(`     - Recent calls: ${recentCalls}`);
  console.log(`   Successfully fetched: ${success}`);
  console.log(`   Failed/No data: ${failed}`);
  console.log(`   Skipped (invalid): ${skipped}`);
  console.log(`   Total candles fetched: ${totalCandles}`);
  console.log(`\n💡 OHLCV data has been stored in ClickHouse!\n`);
  
  // Clean up checkpoint file on successful completion
  if (fs.existsSync(CHECKPOINT_FILE)) {
    fs.unlinkSync(CHECKPOINT_FILE);
    console.log('✅ Checkpoint file removed (completed successfully)\n');
  }
}

/**
 * Save checkpoint to resume later
 */
async function saveCheckpoint(
  lastIndex: number,
  success: number,
  failed: number,
  skipped: number,
  totalCandles: number
): Promise<void> {
  const checkpoint: Checkpoint = {
    lastProcessedIndex: lastIndex,
    totalProcessed: lastIndex + 1,
    success,
    failed,
    skipped,
    totalCandles,
    timestamp: DateTime.now().toISO() || '',
  };
  
  try {
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
  } catch (err) {
    // Ignore checkpoint save errors
  }
}

// Run fetch
fetchMissingOHLCV().catch(console.error);

