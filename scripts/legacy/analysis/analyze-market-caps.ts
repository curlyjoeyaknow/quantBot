#!/usr/bin/env ts-node
/**
 * Analyze Market Caps of Calls
 * 
 * Fetches historical price data and calculates historical market cap by:
 * 1. Getting historical price at call timestamp from /defi/history_price endpoint
 * 2. Getting current supply from /defi/v3/token/market-data or /defi/token_overview
 * 3. Calculating historical market cap = historical_price * supply
 * 
 * Also useful endpoints for future analysis:
 * - /defi/token_creation_info: Returns token creation slot/time, useful for analyzing
 *   token age and sniper slot performance (distance from creation)
 */

import 'dotenv/config';
import { parse } from 'csv-parse';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { DateTime } from 'luxon';
import { fetchHybridCandles } from '../src/simulation/candles';

const CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || '';
const CACHE_DIR = path.join(__dirname, '../cache');

interface CallRecord {
  sender: string;
  tokenAddress: string;
  tokenSymbol: string;
  chain: string;
  timestamp: string;
}

async function getPriceFromCandles(address: string, chain: string, timestamp: string): Promise<number | null> {
  try {
    const alertTime = DateTime.fromISO(timestamp);
    if (!alertTime.isValid) return null;
    
    // Use cache-only mode to avoid API calls - we just want prices from cached candles
    const originalCacheOnly = process.env.USE_CACHE_ONLY;
    process.env.USE_CACHE_ONLY = 'true';
    
    const endTime = alertTime.plus({ days: 7 });
    const candles = await fetchHybridCandles(address, alertTime, endTime, chain);
    
    // Restore original setting
    if (originalCacheOnly === undefined) {
      delete process.env.USE_CACHE_ONLY;
    } else {
      process.env.USE_CACHE_ONLY = originalCacheOnly;
    }
    
    if (candles.length > 0) {
      // Find candle closest to alert time
      const alertTimestamp = alertTime.toMillis() / 1000; // Convert to seconds
      let closestCandle = candles[0];
      let minDiff = Math.abs(candles[0].timestamp - alertTimestamp);
      
      for (const candle of candles) {
        const diff = Math.abs(candle.timestamp - alertTimestamp);
        if (diff < minDiff) {
          minDiff = diff;
          closestCandle = candle;
        }
      }
      
      return closestCandle.close; // Use close price as call price
    }
  } catch (error) {
    // Silently fail
  }
  return null;
}

// Global debug counter to limit debug output
let debugTokenCount = 0;
const MAX_DEBUG_TOKENS = 5;

async function fetchPriceAtTime(address: string, chain: string, timestamp: string): Promise<number | null> {
  // Convert timestamp to Unix seconds
  const alertTime = DateTime.fromISO(timestamp);
  if (!alertTime.isValid) {
    return null;
  }
  
  const unixTimestamp = Math.floor(alertTime.toSeconds());
  const timeWindow = 3600; // 1 hour window around the call time
  
  let price: number | null = null;
  
  try {
    // Get historical price at call timestamp using history_price endpoint
    const historyResponse = await axios.get('https://public-api.birdeye.so/defi/history_price', {
      headers: {
        'X-API-KEY': BIRDEYE_API_KEY,
        'accept': 'application/json',
        'x-chain': chain
      },
      params: {
        address,
        address_type: 'token',
        type: '1m', // 1-minute intervals for precise timestamp matching
        time_from: unixTimestamp - timeWindow,
        time_to: unixTimestamp + timeWindow,
        ui_amount_mode: 'raw'
      },
      timeout: 10000
    });
    
    if (historyResponse.data && historyResponse.data.success && historyResponse.data.data && historyResponse.data.data.items) {
      const items = historyResponse.data.data.items;
      
      if (items.length > 0) {
        // Find the closest price point to the call timestamp
        let closestItem = items[0];
        let minDiff = Math.abs(closestItem.unixTime - unixTimestamp);
        
        for (const item of items) {
          const diff = Math.abs(item.unixTime - unixTimestamp);
          if (diff < minDiff) {
            minDiff = diff;
            closestItem = item;
          }
        }
        
        // Get price from the historical data
        price = closestItem.value || closestItem.price || null;
      }
    }
    
    // Fallback: Try OHLCV endpoint for historical price if history_price didn't work
    if (!price) {
      try {
        const ohlcvResponse = await axios.get('https://public-api.birdeye.so/defi/v3/ohlcv', {
          headers: {
            'X-API-KEY': BIRDEYE_API_KEY,
            'accept': 'application/json',
            'x-chain': chain
          },
          params: {
            address,
            type: '5m',
            currency: 'usd',
            ui_amount_mode: 'raw',
            time_from: unixTimestamp - timeWindow,
            time_to: unixTimestamp + timeWindow,
            mode: 'range',
            padding: true
          },
          timeout: 10000
        });
        
        if (ohlcvResponse.data && ohlcvResponse.data.success && ohlcvResponse.data.data && ohlcvResponse.data.data.items) {
          const candles = ohlcvResponse.data.data.items;
          
          if (candles.length > 0) {
            // Find closest candle
            let closestCandle = candles[0];
            let minDiff = Math.abs(closestCandle.unix_time - unixTimestamp);
            
            for (const candle of candles) {
              const diff = Math.abs(candle.unix_time - unixTimestamp);
              if (diff < minDiff) {
                minDiff = diff;
                closestCandle = candle;
              }
            }
            
            // OHLCV candles use: o (open), c (close), h (high), l (low), v (volume)
            price = closestCandle.c || closestCandle.close || null; // Use close price
          }
        }
      } catch (error) {
        // Silently fail
      }
    }
    
    // Final fallback: Use cached candles for price
    if (!price) {
      price = await getPriceFromCandles(address, chain, timestamp);
    }
  } catch (error) {
    // If history_price fails, fallback to cached candles for price
    if (!price) {
      price = await getPriceFromCandles(address, chain, timestamp);
    }
  }
  
  return price;
}

async function fetchMarketCaps(address: string, chain: string, callTimestamp: string): Promise<{
  priceAtCall: number | null;
  marketCapAtCall: number | null;
  currentPrice: number | null;
  currentMarketCap: number | null;
}> {
  const SUPPLY_1B = 1_000_000_000; // 1 billion for pump/bonk tokens
  
  // Check if this is a pump or bonk token
  const addressLower = address.toLowerCase();
  const isPumpOrBonk = addressLower.includes('pump') || addressLower.includes('bonk');
  
  // Get price at call time
  const priceAtCall = await fetchPriceAtTime(address, chain, callTimestamp);
  
  // Get current price
  let currentPrice: number | null = null;
  try {
    const overviewResponse = await axios.get('https://public-api.birdeye.so/defi/token_overview', {
      headers: {
        'X-API-KEY': BIRDEYE_API_KEY,
        'accept': 'application/json',
        'x-chain': chain
      },
      params: { address },
      timeout: 5000
    });
    
    if (overviewResponse.data?.success && overviewResponse.data?.data) {
      const data = overviewResponse.data.data;
      currentPrice = data.price || data.priceUsd || data.price_usd || null;
    }
  } catch (error) {
    // Silently fail
  }
  
  // Calculate market caps using 1B supply for pump/bonk tokens
  const marketCapAtCall = (priceAtCall && priceAtCall > 0 && isPumpOrBonk) ? priceAtCall * SUPPLY_1B : null;
  const currentMarketCap = (currentPrice && currentPrice > 0 && isPumpOrBonk) ? currentPrice * SUPPLY_1B : null;
  
  return {
    priceAtCall,
    marketCapAtCall,
    currentPrice,
    currentMarketCap
  };
}

async function main() {
  console.log('\n📊 MARKET CAP ANALYSIS\n');
  
  // Load calls
  const csv = fs.readFileSync(CALLS_CSV, 'utf8');
  const records: CallRecord[] = await new Promise((resolve, reject) => {
    parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records as CallRecord[]);
    });
  });

  // Get unique calls
  const uniqueCalls: CallRecord[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const tokenAddress = record.tokenAddress || record.tokenSymbol;
    const timestamp = record.timestamp;
    const key = `${tokenAddress}-${timestamp}`;
    if (!seen.has(key) && tokenAddress && timestamp) {
      seen.add(key);
      uniqueCalls.push(record);
    }
  }

  console.log(`Total unique calls: ${uniqueCalls.length}`);
  console.log('Fetching prices from candles and market caps from Birdeye...\n');

  const marketCaps: number[] = [];
  const prices: number[] = [];
  const DELAY_MS = 200; // Rate limit: ~5 requests/second (slower due to multiple API calls per token)
  const SAMPLE_SIZE = Math.min(500, uniqueCalls.length); // Use more of the 220k CU budget
  debugTokenCount = 0; // Reset debug counter

  for (let i = 0; i < SAMPLE_SIZE; i++) {
    const record = uniqueCalls[i];
    const address = record.tokenAddress;
    const chain = record.chain || 'solana';
    const timestamp = record.timestamp;
    
    const { priceAtCall, marketCapAtCall, currentPrice, currentMarketCap } = await fetchMarketCaps(address, chain, timestamp);
    
    if (priceAtCall && priceAtCall > 0) {
      prices.push(priceAtCall);
    }
    if (marketCapAtCall && marketCapAtCall > 0) {
      marketCaps.push(marketCapAtCall);
    }
    
    if ((i + 1) % 50 === 0) {
      console.log(`Processed ${i + 1}/${SAMPLE_SIZE} calls... (found ${prices.length} prices, ${marketCaps.length} market caps)`);
    }
    
    // Delay between calls to avoid rate limiting (especially important since we make multiple API calls per token)
    await new Promise(resolve => setTimeout(resolve, DELAY_MS));
  }

  if (marketCaps.length === 0 && prices.length === 0) {
    console.log('❌ No market cap or price data found');
    return;
  }

  // Calculate market cap statistics
  if (marketCaps.length > 0) {
    marketCaps.sort((a, b) => a - b);
    const median = marketCaps.length % 2 === 0
      ? (marketCaps[marketCaps.length / 2 - 1] + marketCaps[marketCaps.length / 2]) / 2
      : marketCaps[Math.floor(marketCaps.length / 2)];
    const avg = marketCaps.reduce((a, b) => a + b, 0) / marketCaps.length;
    const min = marketCaps[0];
    const max = marketCaps[marketCaps.length - 1];
    const p25 = marketCaps[Math.floor(marketCaps.length * 0.25)];
    const p75 = marketCaps[Math.floor(marketCaps.length * 0.75)];
    const p90 = marketCaps[Math.floor(marketCaps.length * 0.90)];

    console.log(`\n${'='.repeat(80)}`);
    console.log(`📊 MARKET CAP STATISTICS (${marketCaps.length} calls with data)`);
    console.log(`${'='.repeat(80)}\n`);
    console.log(`Average Market Cap: $${(avg / 1000000).toFixed(2)}M`);
    console.log(`Median Market Cap:  $${(median / 1000000).toFixed(2)}M`);
    console.log(`\nPercentiles:`);
    console.log(`  25th percentile:  $${(p25 / 1000000).toFixed(2)}M`);
    console.log(`  75th percentile:  $${(p75 / 1000000).toFixed(2)}M`);
    console.log(`  90th percentile:  $${(p90 / 1000000).toFixed(2)}M`);
    console.log(`\nRange:`);
    console.log(`  Min Market Cap:   $${(min / 1000000).toFixed(2)}M`);
    console.log(`  Max Market Cap:  $${(max / 1000000).toFixed(2)}M`);
    console.log('');
  }

  // Calculate price statistics
  if (prices.length > 0) {
    prices.sort((a, b) => a - b);
    const priceMedian = prices.length % 2 === 0
      ? (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2
      : prices[Math.floor(prices.length / 2)];
    const priceAvg = prices.reduce((a, b) => a + b, 0) / prices.length;

    console.log(`\n${'='.repeat(80)}`);
    console.log(`💰 PRICE STATISTICS (${prices.length} calls with price data from candles)`);
    console.log(`${'='.repeat(80)}\n`);
    console.log(`Average Price: $${priceAvg.toFixed(8)}`);
    console.log(`Median Price:  $${priceMedian.toFixed(8)}`);
    console.log(`Min Price:     $${prices[0].toFixed(8)}`);
    console.log(`Max Price:     $${prices[prices.length - 1].toFixed(8)}`);
    console.log('');
  }

  // Analyze by caller
  const callers = ['Brook', 'Maxi', 'Exy', 'Croz', 'Giga'];
  const callerPatterns: Record<string, string[]> = {
    'Brook': ['Brook'],
    'Maxi': ['meta maxist', 'maxi'],
    'Exy': ['exy'],
    'Croz': ['croz'],
    'Giga': ['Brook Giga', 'Giga']
  };

  console.log(`${'='.repeat(80)}`);
  console.log('📊 MARKET CAP BY CALLER\n');
  
  for (const caller of callers) {
    const patterns = callerPatterns[caller];
    const callerCalls = uniqueCalls.filter(r => {
      const sender = (r.sender || '').split('\n')[0].trim().toLowerCase();
      return patterns.some(p => sender.includes(p.toLowerCase()));
    });

    const callerMarketCaps: number[] = [];
    const callerPrices: number[] = [];
    const sampleSize = Math.min(100, callerCalls.length);
    
    for (let i = 0; i < sampleSize; i++) {
      const record = callerCalls[i];
      const { priceAtCall, marketCapAtCall } = await fetchMarketCaps(record.tokenAddress, record.chain || 'solana', record.timestamp);
      if (priceAtCall && priceAtCall > 0) {
        callerPrices.push(priceAtCall);
      }
      if (marketCapAtCall && marketCapAtCall > 0) {
        callerMarketCaps.push(marketCapAtCall);
      }
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }

    if (callerMarketCaps.length > 0 || callerPrices.length > 0) {
      console.log(`${caller}:`);
      if (callerMarketCaps.length > 0) {
        callerMarketCaps.sort((a, b) => a - b);
        const callerMedian = callerMarketCaps.length % 2 === 0
          ? (callerMarketCaps[callerMarketCaps.length / 2 - 1] + callerMarketCaps[callerMarketCaps.length / 2]) / 2
          : callerMarketCaps[Math.floor(callerMarketCaps.length / 2)];
        const callerAvg = callerMarketCaps.reduce((a, b) => a + b, 0) / callerMarketCaps.length;
        console.log(`  Market Cap - Avg: $${(callerAvg / 1000000).toFixed(2)}M, Median: $${(callerMedian / 1000000).toFixed(2)}M (${callerMarketCaps.length} samples)`);
      }
      if (callerPrices.length > 0) {
        callerPrices.sort((a, b) => a - b);
        const priceMedian = callerPrices.length % 2 === 0
          ? (callerPrices[callerPrices.length / 2 - 1] + callerPrices[callerPrices.length / 2]) / 2
          : callerPrices[Math.floor(callerPrices.length / 2)];
        const priceAvg = callerPrices.reduce((a, b) => a + b, 0) / callerPrices.length;
        console.log(`  Price - Avg: $${priceAvg.toFixed(8)}, Median: $${priceMedian.toFixed(8)} (${callerPrices.length} samples)`);
      }
      console.log('');
    }
  }
}

main().catch(console.error);

