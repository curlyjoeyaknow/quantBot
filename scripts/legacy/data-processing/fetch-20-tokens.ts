#!/usr/bin/env ts-node
/**
 * Fetch Candles for 20 Tokens Without Candles
 * 
 * Fetches OHLCV data for the 20 tokens identified as missing candles
 */

import 'dotenv/config';

import { DateTime } from 'luxon';
import { fetchHybridCandles } from '../src/simulation/candles';
import { initClickHouse, closeClickHouse } from '../src/storage/clickhouse-client';

// The next 20 tokens without candles (tokens 21-40)
const tokensToFetch = [
  { tokenAddress: 't5xgMrnnqYNQFZZkSJNGU9xghPi9Y3p1kj5AhtYpump', chain: 'solana', unixTime: 1753000563, endUnixTime: 1758184563 },
  { tokenAddress: 'ufxNwEGJWEz4f8Lf9xqx32J75i3QsMUwAWLeDsK8Lc7g', chain: 'solana', unixTime: 1753009150, endUnixTime: 1758193150 },
  { tokenAddress: '7b2JcU6vsVkjXEZoJZD1VGn7gNL3Z1QKXF6Yb9B8NkXQ', chain: 'solana', unixTime: 1753010080, endUnixTime: 1758194080 },
  { tokenAddress: 'js71zMNmZ9EMvgyKtoafAxgqALKjdmM8qzTJGHB4EEbo', chain: 'solana', unixTime: 1753015853, endUnixTime: 1758199853 },
  { tokenAddress: 'A9kWRELkvAZeFkKuj6abgacakH9rLDzhqSaEh2Rjbonk', chain: 'solana', unixTime: 1753015948, endUnixTime: 1758199948 },
  { tokenAddress: '7L11EwmNRz4A4oj6jErkFR2CjSbAPadgwAGz7vGobonk', chain: 'solana', unixTime: 1753017758, endUnixTime: 1758201758 },
  { tokenAddress: 'HgYLyCewdSQUJWqTrbL5bVHTinJxWwDoDFcA2WbTbonk', chain: 'solana', unixTime: 1753020995, endUnixTime: 1758204995 },
  { tokenAddress: '9AtRdmYjQ4zGz7YBFcJeLEeF3rh464vqCbQLgqB7bonk', chain: 'solana', unixTime: 1753021306, endUnixTime: 1758205306 },
  { tokenAddress: 'Dp3685dMohwgPoqp75oZWcsaDRG2pZfmgXWGjugPbonk', chain: 'solana', unixTime: 1753024264, endUnixTime: 1758208264 },
  { tokenAddress: '8r6zFTaNdcA9E9tuSM6Hd2AoEpGst58cCk7nGxMVbonk', chain: 'solana', unixTime: 1753027684, endUnixTime: 1758211684 },
  { tokenAddress: '4ZJf38dnj9ENz62uCG4E15RbmHi6ZQdQkXp9gEw9bonk', chain: 'solana', unixTime: 1753030005, endUnixTime: 1758214005 },
  { tokenAddress: '3KXNxQiy4mR8byT3H8RBeECUj4TtHxGUn393c47Dbonk', chain: 'solana', unixTime: 1753031632, endUnixTime: 1758215632 },
  { tokenAddress: '9UUKsR28bZ5yNKK31GocRBNm1DSDHidxVepXB7bWbonk', chain: 'solana', unixTime: 1753042040, endUnixTime: 1758226040 },
  { tokenAddress: 'HKZQxDqqw1U7MmzEcjc4JocEnZJ75nBKudcKs8xgbonk', chain: 'solana', unixTime: 1753042084, endUnixTime: 1758226084 },
  { tokenAddress: '2kkwPP6Y5v4aSteLo2R6uqmx3aQ6Veb1xDcRXHsNbonk', chain: 'solana', unixTime: 1753063030, endUnixTime: 1758247030 },
  { tokenAddress: '96hxhKLnHuJSseVFX4mpxQJ1TAQScAAT7tFHZVzBbonk', chain: 'solana', unixTime: 1753063044, endUnixTime: 1758247044 },
  { tokenAddress: 'HzCStXuaVTFvyZ4Dj2scxZnE1uoNsFX2BvCga3ZRbonk', chain: 'solana', unixTime: 1753063056, endUnixTime: 1758247056 },
  { tokenAddress: 'HRu46EQFHbNjnNcWkw1xV6Ck83g7DVMDo3jHoE2Bbonk', chain: 'solana', unixTime: 1753083504, endUnixTime: 1758267504 },
  { tokenAddress: '8MxjSs3kEPmfiqKN1S4o3PABp198uYyx4gLF1TvZbonk', chain: 'solana', unixTime: 1753083513, endUnixTime: 1758267513 },
  { tokenAddress: '3LBDmVsUMY4XF82kVruJxrZqLnhUBFqanMdn5ifCbonk', chain: 'solana', unixTime: 1753083780, endUnixTime: 1758267780 },
];

async function fetch20Tokens() {
  console.log('🚀 Fetching candles for 20 tokens...\n');
  
  // Initialize ClickHouse
  await initClickHouse();
  console.log('✅ ClickHouse initialized\n');
  
  let success = 0;
  let failed = 0;
  let totalCandles = 0;
  
  for (let i = 0; i < tokensToFetch.length; i++) {
    const { tokenAddress, chain, unixTime, endUnixTime } = tokensToFetch[i];
    const displayAddr = tokenAddress.length > 30 ? tokenAddress.substring(0, 30) + '...' : tokenAddress;
    
    console.log(`[${i + 1}/20] Fetching ${displayAddr}...`);
    
    try {
      const alertTime = DateTime.fromSeconds(unixTime);
      const endTime = DateTime.fromSeconds(endUnixTime);
      
      const candles = await fetchHybridCandles(tokenAddress, alertTime, endTime, chain);
      
      if (candles.length > 0) {
        success++;
        totalCandles += candles.length;
        console.log(`   ✅ Fetched ${candles.length} candles\n`);
      } else {
        failed++;
        console.log(`   ⚠️  No candles returned\n`);
      }
      
      // Rate limiting: 15 requests per second (900 RPM)
      await new Promise(resolve => setTimeout(resolve, 70));
      
    } catch (error: any) {
      failed++;
      console.log(`   ❌ Error: ${error.message}\n`);
    }
  }
  
  await closeClickHouse();
  
  console.log('\n✅ Fetch Complete!\n');
  console.log(`📊 Summary:`);
  console.log(`   Success: ${success}/20`);
  console.log(`   Failed: ${failed}/20`);
  console.log(`   Total candles fetched: ${totalCandles}\n`);
}

fetch20Tokens().catch(console.error);

