#!/usr/bin/env ts-node
/**
 * Fetch Missing Brook Giga Candles
 * 
 * Identifies Brook Giga tokens that don't have candle data in ClickHouse
 * and attempts to fetch them from Birdeye API.
 */

// Load environment variables from .env file
import 'dotenv/config';

import { DateTime } from 'luxon';
import { parse } from 'csv-parse';
import * as fs from 'fs';
import * as path from 'path';
import { fetchHybridCandles } from '../src/simulation/candles';
import { initClickHouse, hasCandles, closeClickHouse } from '../src/storage/clickhouse-client';

const BROOK_CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');
const TARGET_CALLER = 'Brook Giga I verify @BrookCalls';

interface TokenInfo {
  tokenAddress: string;
  chain: string;
  timestamp: string;
  caller: string;
}

async function fetchMissingBrookGigaCandles() {
  console.log(`\n${'='.repeat(80)}`);
  console.log('🚀 FETCHING MISSING BROOK GIGA CANDLES');
  console.log(`${'='.repeat(80)}\n`);

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

  // Filter to Brook Giga calls only
  console.log(`🎯 Filtering calls to: ${TARGET_CALLER}...`);
  let brookGigaCalls = records.filter(record => {
    const caller = (record.sender || record.caller || '').trim();
    const normalizedCaller = caller.toLowerCase();
    return normalizedCaller === TARGET_CALLER.toLowerCase() || 
           normalizedCaller.includes('brook giga');
  });
  console.log(`✅ Found ${brookGigaCalls.length} Brook Giga calls\n`);

  // Deduplicate: Only process unique tokens
  console.log('🔍 Deduplicating calls by token address...');
  const uniqueTokens = new Map<string, TokenInfo>();
  for (const record of brookGigaCalls) {
    const tokenAddress = record.tokenAddress || record.mint;
    const chain = record.chain || 'solana';
    
    if (!tokenAddress) continue;
    
    const key = `${chain}:${tokenAddress.toLowerCase()}`;
    // Use first call for each unique token
    if (!uniqueTokens.has(key)) {
      uniqueTokens.set(key, {
        tokenAddress,
        chain,
        timestamp: record.timestamp || record.alertTime || '',
        caller: record.sender || record.caller || '',
      });
    }
  }
  
  const uniqueCalls = Array.from(uniqueTokens.values());
  console.log(`✅ Deduplicated: ${uniqueCalls.length} unique tokens\n`);

  // Check which tokens are missing candles
  console.log('🔍 Checking which tokens are missing candle data...');
  const tokensWithoutCandles: TokenInfo[] = [];
  
  for (let i = 0; i < uniqueCalls.length; i++) {
    const call = uniqueCalls[i];
    const tokenAddress = call.tokenAddress;
    const chain = call.chain;
    
    if (!tokenAddress) continue;
    
    const alertTime = DateTime.fromISO(call.timestamp);
    if (!alertTime.isValid) {
      console.log(`   ⏭️  Skipping ${tokenAddress.substring(0, 20)}... - invalid timestamp`);
      continue;
    }
    
    const endTime = alertTime.plus({ days: 7 });
    
    // Check if candles exist
    const hasData = await hasCandles(tokenAddress, chain, alertTime, endTime);
    
    if (!hasData) {
      tokensWithoutCandles.push(call);
    }
    
    if ((i + 1) % 50 === 0) {
      console.log(`   Checked ${i + 1}/${uniqueCalls.length} tokens... ${tokensWithoutCandles.length} missing candles`);
    }
  }
  
  console.log(`\n✅ Found ${tokensWithoutCandles.length} tokens without candle data (out of ${uniqueCalls.length} total)\n`);

  if (tokensWithoutCandles.length === 0) {
    console.log('🎉 All tokens already have candle data! No fetching needed.\n');
    await closeClickHouse();
    return;
  }

  // Fetch candles for missing tokens
  console.log(`🔄 Fetching candles for ${tokensWithoutCandles.length} tokens...\n`);
  console.log('⚠️  Note: This will make API calls to Birdeye. Rate limiting: ~15 req/sec\n');
  
  let success = 0;
  let failed = 0;
  let skipped = 0;
  let totalCandles = 0;
  
  // Enable ClickHouse saving
  process.env.USE_CLICKHOUSE = 'true';
  
  for (let i = 0; i < tokensWithoutCandles.length; i++) {
    const call = tokensWithoutCandles[i];
    const tokenAddress = call.tokenAddress;
    const chain = call.chain;
    const displayAddr = tokenAddress.length > 30 ? tokenAddress.substring(0, 30) + '...' : tokenAddress;
    
    // Progress update every 10 tokens
    if (i % 10 === 0 || i === 0) {
      const progress = ((i + 1) / tokensWithoutCandles.length) * 100;
      console.log(`[${i + 1}/${tokensWithoutCandles.length}] (${progress.toFixed(1)}%) Fetching ${displayAddr}...`);
    }
    
    try {
      const alertTime = DateTime.fromISO(call.timestamp);
      if (!alertTime.isValid) {
        skipped++;
        if (i % 10 === 0) {
          console.log(`   ⏭️  Skipped: Invalid timestamp\n`);
        }
        continue;
      }
      
      const endTime = alertTime.plus({ days: 7 });
      
      // Fetch candles (will auto-save to ClickHouse if USE_CLICKHOUSE=true)
      const candles = await fetchHybridCandles(tokenAddress, alertTime, endTime, chain);
      
      if (candles.length >= 10) {
        success++;
        totalCandles += candles.length;
        if (i % 10 === 0 || i === 0) {
          console.log(`   ✅ Fetched ${candles.length} candles\n`);
        }
      } else if (candles.length > 0) {
        success++;
        totalCandles += candles.length;
        if (i % 10 === 0 || i === 0) {
          console.log(`   ⚠️  Limited candles (${candles.length}) - saved anyway\n`);
        }
      } else {
        failed++;
        if (i % 10 === 0 || i === 0) {
          console.log(`   ⚠️  No candles returned (token may not exist or have no data)\n`);
        }
      }
      
      // Rate limiting: 15 requests per second (900 RPM)
      await new Promise(resolve => setTimeout(resolve, 70));
      
    } catch (error: any) {
      failed++;
      if (i % 10 === 0 || i === 0) {
        console.log(`   ❌ Error: ${error.message}\n`);
      }
    }
  }
  
  await closeClickHouse();
  
  console.log(`\n${'='.repeat(80)}`);
  console.log('✅ FETCH COMPLETE');
  console.log(`${'='.repeat(80)}\n`);
  console.log(`📊 Summary:`);
  console.log(`   Total tokens checked: ${uniqueCalls.length}`);
  console.log(`   Tokens without candles: ${tokensWithoutCandles.length}`);
  console.log(`   Successfully fetched: ${success}`);
  console.log(`   Failed/No data: ${failed}`);
  console.log(`   Skipped (invalid): ${skipped}`);
  console.log(`   Total candles fetched: ${totalCandles}`);
  console.log(`\n💡 You can now re-run the optimization script to test all ${uniqueCalls.length} tokens!\n`);
}

// Run fetch
fetchMissingBrookGigaCandles().catch(console.error);

