#!/usr/bin/env ts-node
/**
 * Fetch Remaining Tokens with Birdeye Check
 * 
 * For tokens that hasCandles says don't exist, check Birdeye directly
 * to see if they actually have data, then fetch if they do.
 */

import 'dotenv/config';

import { DateTime } from 'luxon';
import { parse } from 'csv-parse';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { fetchHybridCandles } from '../src/simulation/candles';
import { initClickHouse, hasCandles, closeClickHouse } from '../src/storage/clickhouse-client';

const BROOK_CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || '8d0804d5859c4fac83ca5bc3a21daed2';

async function checkBirdeyeHasData(tokenAddress: string, chain: string): Promise<boolean> {
  try {
    const response = await axios.get('https://public-api.birdeye.so/defi/price', {
      headers: {
        accept: 'application/json',
        'x-chain': chain,
        'X-API-KEY': BIRDEYE_API_KEY
      },
      params: {
        address: tokenAddress,
        ui_amount_mode: 'raw'
      },
      validateStatus: (status) => status < 500
    });
    
    return response.status === 200 && response.data?.success === true && response.data?.data?.value !== undefined;
  } catch (error: any) {
    return false;
  }
}

async function fetchRemainingWithBirdeyeCheck() {
  console.log('🔍 Checking remaining tokens with Birdeye...\n');
  
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
  
  // Get unique tokens
  const uniqueTokens = new Map<string, { chain: string; timestamp: string; tokenAddress: string }>();
  for (const record of records) {
    const tokenAddress = record.tokenAddress || record.mint;
    const chain = record.chain || 'solana';
    const timestamp = record.timestamp;
    
    if (tokenAddress && timestamp) {
      const key = `${chain}:${tokenAddress}`;
      if (!uniqueTokens.has(key)) {
        uniqueTokens.set(key, { chain, timestamp, tokenAddress });
      }
    }
  }
  
  console.log(`📊 Checking ${uniqueTokens.size} unique tokens...\n`);
  
  const tokensToFetch: Array<{ tokenAddress: string; chain: string; timestamp: string }> = [];
  let checked = 0;
  let hasCandlesCount = 0;
  let noCandlesCount = 0;
  
  for (const [key, { chain, timestamp, tokenAddress }] of uniqueTokens.entries()) {
    checked++;
    
    if (checked % 200 === 0) {
      console.log(`   Checked ${checked}/${uniqueTokens.size} tokens... (found ${tokensToFetch.length} to fetch)`);
    }
    
    try {
      const alertTime = DateTime.fromISO(timestamp);
      if (!alertTime.isValid) {
        continue;
      }
      
      // Check ClickHouse first
      const endTime = alertTime.plus({ days: 60 });
      const hasData = await hasCandles(tokenAddress, chain, alertTime, endTime);
      
      if (hasData) {
        hasCandlesCount++;
        continue;
      }
      
      // Not in ClickHouse - check Birdeye directly
      const birdeyeHasData = await checkBirdeyeHasData(tokenAddress, chain);
      
      if (birdeyeHasData) {
        tokensToFetch.push({ tokenAddress, chain, timestamp });
        console.log(`   ✅ Found on Birdeye (not in ClickHouse): ${tokenAddress.substring(0, 30)}...`);
      } else {
        noCandlesCount++;
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 70));
      
    } catch (error: any) {
      // Skip on error
    }
  }
  
  await closeClickHouse();
  
  console.log(`\n📊 Summary:`);
  console.log(`   Total tokens: ${uniqueTokens.size}`);
  console.log(`   Already in ClickHouse: ${hasCandlesCount}`);
  console.log(`   Found on Birdeye (need fetch): ${tokensToFetch.length}`);
  console.log(`   Not on Birdeye: ${noCandlesCount}\n`);
  
  if (tokensToFetch.length === 0) {
    console.log('✅ No tokens to fetch!\n');
    return;
  }
  
  console.log(`🚀 Fetching ${tokensToFetch.length} tokens...\n`);
  
  await initClickHouse();
  
  let success = 0;
  let failed = 0;
  let totalCandles = 0;
  
  for (let i = 0; i < tokensToFetch.length; i++) {
    const { tokenAddress, chain, timestamp } = tokensToFetch[i];
    const displayAddr = tokenAddress.length > 30 ? tokenAddress.substring(0, 30) + '...' : tokenAddress;
    
    if (i % 10 === 0 || i === 0) {
      console.log(`[${i + 1}/${tokensToFetch.length}] Fetching ${displayAddr}...`);
    }
    
    try {
      const alertTime = DateTime.fromISO(timestamp);
      const endTime = alertTime.plus({ days: 60 });
      
      const candles = await fetchHybridCandles(tokenAddress, alertTime, endTime, chain);
      
      if (candles.length > 0) {
        success++;
        totalCandles += candles.length;
        if (i % 10 === 0 || i === 0) {
          console.log(`   ✅ Fetched ${candles.length} candles\n`);
        }
      } else {
        failed++;
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 70));
      
    } catch (error: any) {
      failed++;
      if (i % 10 === 0 || i === 0) {
        console.log(`   ❌ Error: ${error.message}\n`);
      }
    }
  }
  
  await closeClickHouse();
  
  console.log('\n✅ Fetch Complete!\n');
  console.log(`📊 Final Summary:`);
  console.log(`   Success: ${success}/${tokensToFetch.length}`);
  console.log(`   Failed: ${failed}/${tokensToFetch.length}`);
  console.log(`   Total candles fetched: ${totalCandles}\n`);
}

fetchRemainingWithBirdeyeCheck().catch(console.error);

