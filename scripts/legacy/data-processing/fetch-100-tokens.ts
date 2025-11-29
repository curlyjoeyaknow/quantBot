#!/usr/bin/env ts-node
/**
 * Fetch Candles for 100 Tokens Without Candles
 * 
 * Fetches OHLCV data for 100 tokens identified as missing candles
 */

import 'dotenv/config';

import { DateTime } from 'luxon';
import { fetchHybridCandles } from '../src/simulation/candles';
import { initClickHouse, closeClickHouse } from '../src/storage/clickhouse-client';

// The next 100 tokens without candles (tokens 41-140)
const tokensToFetch = [
  { tokenAddress: 'x4444b769e3cadb4fa1f623d1b1b6a38e423d69ae', chain: 'solana', unixTime: 1761074932, endUnixTime: 1766258932 },
  { tokenAddress: 'D65Jr6jUe5swtbBdfZvieNqsunEBGRwzGpHJPBZ1111J', chain: 'solana', unixTime: 1761125170, endUnixTime: 1766309170 },
  { tokenAddress: 'a897317d79ba14a29c5cf7214715e5d3ff4444', chain: 'solana', unixTime: 1761129719, endUnixTime: 1766313719 },
  { tokenAddress: 'x4444c37e9e91f95d89c8f462eebee8fa51', chain: 'solana', unixTime: 1761135719, endUnixTime: 1766319719 },
  { tokenAddress: 'xf2f831382d1246464a566287fabaead', chain: 'solana', unixTime: 1761150887, endUnixTime: 1766334887 },
  { tokenAddress: '99595c1de65d8e3e44643d951c8f59bb34444', chain: 'solana', unixTime: 1761250445, endUnixTime: 1766434445 },
  { tokenAddress: 'x9be61a38725b265bc3eb7bfdf17afdfc9d26c13', chain: 'solana', unixTime: 1761304500, endUnixTime: 1766488500 },
  { tokenAddress: 'x23b35C7f686CAC8297eA6e81A467286481cA4444Js', chain: 'solana', unixTime: 1761308149, endUnixTime: 1766492149 },
  { tokenAddress: 'x1f6fbd4b6ed14fca59b8fc2f7dbc9cfeeb344444Mov', chain: 'solana', unixTime: 1761381898, endUnixTime: 1766565898 },
  { tokenAddress: 'ZERESYSGKEGxPuznVZYHh5J4Hqk8kSabgPjJTYviLLhf', chain: 'solana', unixTime: 1761388524, endUnixTime: 1766572524 },
  { tokenAddress: 'xbe2f23569bcea6421eeff33eee3718d61', chain: 'solana', unixTime: 1761501918, endUnixTime: 1766685918 },
  { tokenAddress: 'x74ba6142b659edd2521164fecc92ab733fc24444Mig', chain: 'solana', unixTime: 1761511157, endUnixTime: 1766695157 },
  { tokenAddress: 'sdFmUe2Q8Ho8SEhbp5uXU9d4wCZzD8fHSvhLC6mX777A', chain: 'solana', unixTime: 1761551433, endUnixTime: 1766735433 },
  { tokenAddress: '9i6VKcG8oGdsibhCSqEzZQQAwiVgcK3N58hmwpC6q31v', chain: 'solana', unixTime: 1761562270, endUnixTime: 1766746270 },
  { tokenAddress: 'xa31de7db919b1499bf8d96daa861227', chain: 'solana', unixTime: 1761576799, endUnixTime: 1766760799 },
  { tokenAddress: 'x35be386279699159b3d7c611adf43d5', chain: 'solana', unixTime: 1761599701, endUnixTime: 1766783701 },
  { tokenAddress: '9c6996e7dfa88c7463b899f4754794444', chain: 'solana', unixTime: 1761640362, endUnixTime: 1766824362 },
  { tokenAddress: 'xffb335af292badbfe63484b3867ad98af9ad4444', chain: 'solana', unixTime: 1761666381, endUnixTime: 1766850381 },
  { tokenAddress: 'this2wK6ixQzEEWpoykCoaXDqp3rnYQVqkqoKM55a1Rb', chain: 'solana', unixTime: 1761682148, endUnixTime: 1766866148 },
  { tokenAddress: 'BeZmdwZqUJuZxVoa4Lj4zmwvUBQmv6k3g6MYjTWCMj8q', chain: 'solana', unixTime: 1761755315, endUnixTime: 1766939315 },
  { tokenAddress: '3w8dzjbbb6nvfvaedyytxbmnymepkt7v2czptv6j6weh', chain: 'solana', unixTime: 1761810139, endUnixTime: 1766994139 },
  { tokenAddress: '6ab1534f58cfe688628ce475a8eaa8663', chain: 'solana', unixTime: 1761820524, endUnixTime: 1767004524 },
  { tokenAddress: 'x87bdb859bfdf5bc2f68153b64528e1b1d4eb4444', chain: 'solana', unixTime: 1761956890, endUnixTime: 1767140890 },
  { tokenAddress: '7Y6b6Kp5xqzmi1tigPTV2Mb8yWPhMtHTWnoTQ2xu6UFp', chain: 'solana', unixTime: 1762227042, endUnixTime: 1767411042 },
  { tokenAddress: '7c54d9e3163941b4924d8c15af22a6ca', chain: 'solana', unixTime: 1762260954, endUnixTime: 1767444954 },
  { tokenAddress: '67zUkpExydmyx2S2jvh9MccXjxetB8EyUkV5LNYgZkSZ', chain: 'solana', unixTime: 1762346874, endUnixTime: 1767530874 }
];

async function fetch100Tokens() {
  console.log('🚀 Fetching candles for 100 tokens...\n');
  
  // Initialize ClickHouse
  await initClickHouse();
  console.log('✅ ClickHouse initialized\n');
  
  let success = 0;
  let failed = 0;
  let totalCandles = 0;
  
  for (let i = 0; i < tokensToFetch.length; i++) {
    const { tokenAddress, chain, unixTime, endUnixTime } = tokensToFetch[i];
    const displayAddr = tokenAddress.length > 30 ? tokenAddress.substring(0, 30) + '...' : tokenAddress;
    
    // Progress update every 10 tokens
    if (i % 10 === 0 || i === 0) {
      console.log(`[${i + 1}/100] Processing ${displayAddr}...`);
    }
    
    try {
      const alertTime = DateTime.fromSeconds(unixTime);
      const endTime = DateTime.fromSeconds(endUnixTime);
      
      const candles = await fetchHybridCandles(tokenAddress, alertTime, endTime, chain);
      
      if (candles.length > 0) {
        success++;
        totalCandles += candles.length;
        if (i % 10 === 0 || i === 0) {
          console.log(`   ✅ Fetched ${candles.length} candles\n`);
        }
      } else {
        failed++;
        if (i % 10 === 0 || i === 0) {
          console.log(`   ⚠️  No candles returned\n`);
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
  
  console.log('\n✅ Fetch Complete!\n');
  console.log(`📊 Summary:`);
  console.log(`   Success: ${success}/100`);
  console.log(`   Failed: ${failed}/100`);
  console.log(`   Total candles fetched: ${totalCandles}\n`);
}

fetch100Tokens().catch(console.error);

