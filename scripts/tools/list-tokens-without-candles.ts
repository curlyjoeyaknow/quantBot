#!/usr/bin/env ts-node
/**
 * List Tokens Without Candles
 * 
 * Finds tokens from the calls CSV that don't have candles in ClickHouse
 */

import 'dotenv/config';

import { DateTime } from 'luxon';
import { parse } from 'csv-parse';
import * as fs from 'fs';
import * as path from 'path';
import { initClickHouse, hasCandles, closeClickHouse } from '../src/storage/clickhouse-client';

const BROOK_CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');

async function findTokensWithoutCandles() {
  console.log('Finding tokens without candles...\n');
  
  // Initialize ClickHouse
  await initClickHouse();
  console.log('ClickHouse initialized\n');
  
  // Load calls data
  console.log('Loading calls data...');
  const csv = fs.readFileSync(BROOK_CALLS_CSV, 'utf8');
  const records: any[] = await new Promise((resolve, reject) => {
    parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records);
    });
  });
  console.log(`Loaded ${records.length} calls\n`);
  
  // Get unique tokens
  const uniqueTokens = new Map<string, { chain: string; timestamp: string; tokenAddress: string }>();
  for (const record of records) {
    const tokenAddress = record.tokenAddress || record.mint;
    const chain = record.chain || 'solana';
    const timestamp = record.timestamp;
    
    if (tokenAddress && timestamp) {
      // Use full address as key (case-sensitive)
      const key = `${chain}:${tokenAddress}`;
      if (!uniqueTokens.has(key)) {
        uniqueTokens.set(key, { chain, timestamp, tokenAddress });
      }
    }
  }
  
  console.log(`Found ${uniqueTokens.size} unique tokens\n`);
  console.log('Checking ClickHouse for candles...\n');
  
  const tokensWithoutCandles: Array<{ tokenAddress: string; chain: string; timestamp: string }> = [];
  let checked = 0;
  
  for (const [key, { chain, timestamp, tokenAddress }] of uniqueTokens.entries()) {
    checked++;
    
    if (checked % 100 === 0) {
      console.log(`   Checked ${checked}/${uniqueTokens.size} tokens... (found ${tokensWithoutCandles.length} without candles)`);
    }
    
    try {
      const alertTime = DateTime.fromISO(timestamp);
      if (!alertTime.isValid) {
        continue;
      }
      
      // Check if candles exist in ClickHouse
      const endTime = alertTime.plus({ days: 60 });
      const hasData = await hasCandles(tokenAddress, chain, alertTime, endTime);
      
      if (!hasData) {
        tokensWithoutCandles.push({ tokenAddress, chain, timestamp });
        
        // Stop once we have 540 (to get next 100 after first 440)
        if (tokensWithoutCandles.length >= 540) {
          break;
        }
      }
    } catch (error: any) {
      // If error checking, assume no candles
      tokensWithoutCandles.push({ tokenAddress, chain, timestamp });
      if (tokensWithoutCandles.length >= 20) {
        break;
      }
    }
  }
  
  await closeClickHouse();
  
  // Show only the next 100 (skip first 440)
  const next100 = tokensWithoutCandles.slice(440, 540);
  
  console.log(`\nFound ${tokensWithoutCandles.length} tokens without candles`);
  console.log(`Showing next 100 (tokens 441-540):\n`);
  
  for (let i = 0; i < next100.length; i++) {
    const { tokenAddress, chain, timestamp } = next100[i];
    // Convert ISO timestamp to Unix timestamp
    const alertTime = DateTime.fromISO(timestamp);
    const unixTime = alertTime.isValid ? Math.floor(alertTime.toSeconds()) : null;
    const endUnixTime = alertTime.isValid ? Math.floor(alertTime.plus({ days: 60 }).toSeconds()) : null;
    
    if (unixTime && endUnixTime) {
      console.log(`${i + 1}. ${tokenAddress} (${chain}) - ${unixTime} to ${endUnixTime}`);
    } else {
      console.log(`${i + 1}. ${tokenAddress} (${chain}) - ${timestamp} (invalid timestamp)`);
    }
  }
  
  console.log('\n');
}

findTokensWithoutCandles().catch(console.error);
