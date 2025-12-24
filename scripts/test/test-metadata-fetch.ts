#!/usr/bin/env ts-node
/**
 * Test metadata fetching for sample token addresses
 */

import 'dotenv/config';
import * as path from 'path';
import * as fs from 'fs';
import { parse } from 'csv-parse';
import axios from 'axios';

const BIRDEYE_API_KEY =
  process.env.BIRDEYE_API_KEY ||
  process.env.BIRDEYE_API_KEY_1 ||
  'dec8084b90724ffe949b68d0a18359d6';
const CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');

// Test token addresses (mix of DB tokens and common tokens)
const TEST_TOKENS = [
  '8lowysfcwg2anp5qimbnnikee4hknnwswg96w6fbdyxu', // MoonLad - from DB
  'ew5svpb2rgxmrqw1wxahet176wcxnwm2q24xjuvtpuue', // MoonLad - from DB
  '7cha2lknwfnskpzy9vvbfrqg3cqtwhjguwkykdjne3gz', // Otto - from DB
  'So11111111111111111111111111111111111111112', // SOL (Wrapped SOL)
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
];

/**
 * Fetch token metadata from free sources (local DB, CSV, Solscan, Birdeye)
 */
async function fetchTokenMetadata(
  tokenAddress: string,
  chain: string = 'solana'
): Promise<{ name: string; symbol: string }> {
  if (chain !== 'solana') {
    return {
      name: `Token ${tokenAddress}`,
      symbol: tokenAddress.toUpperCase(),
    };
  }

  console.log(`\n🔍 Fetching metadata for: ${tokenAddress}`);

  // Step 1: Try local database (caller_alerts.db)
  try {
    const sqlite3 = require('sqlite3');
    const { promisify } = require('util');
    const dbPath = process.env.CALLER_DB_PATH || path.join(__dirname, '../caller_alerts.db');

    if (fs.existsSync(dbPath)) {
      const db = new sqlite3.Database(dbPath);
      const get = promisify(db.get.bind(db));

      const row: any = await get(
        'SELECT token_symbol FROM caller_alerts WHERE token_address = ? AND token_symbol IS NOT NULL AND token_symbol != "UNKNOWN" AND token_symbol != "" LIMIT 1',
        [tokenAddress.toLowerCase()]
      );

      db.close();

      if (row && row.token_symbol) {
        console.log(`   ✅ Found in DB: ${row.token_symbol}`);
        return {
          name: row.token_symbol, // Use symbol as name since DB doesn't have name
          symbol: row.token_symbol,
        };
      } else {
        console.log(`   ❌ Not found in DB`);
      }
    } else {
      console.log(`   ⚠️  DB file not found: ${dbPath}`);
    }
  } catch (error: any) {
    console.log(`   ❌ DB error: ${error.message}`);
  }

  // Step 2: Try CSV file (all_brook_channels_calls.csv)
  try {
    const csvPath = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');
    if (fs.existsSync(csvPath)) {
      const csv = fs.readFileSync(csvPath, 'utf8');
      const records: any[] = await new Promise((resolve, reject) => {
        parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
          if (err) reject(err);
          else resolve(records);
        });
      });

      const match = records.find((r: any) => {
        const addr = r.tokenAddress || r.token_address || '';
        const symbol = r.tokenSymbol || r.token_symbol || '';
        return (
          addr.toLowerCase() === tokenAddress.toLowerCase() &&
          symbol &&
          symbol !== 'UNKNOWN' &&
          symbol !== ''
        );
      });

      if (match) {
        const symbol = match.tokenSymbol || match.token_symbol || '';
        const name = match.tokenName || match.token_name || symbol;
        console.log(`   ✅ Found in CSV: ${name} (${symbol})`);
        return {
          name: name || `Token ${tokenAddress}`,
          symbol: symbol,
        };
      } else {
        console.log(`   ❌ Not found in CSV`);
      }
    } else {
      console.log(`   ⚠️  CSV file not found: ${csvPath}`);
    }
  } catch (error: any) {
    console.log(`   ❌ CSV error: ${error.message}`);
  }

  // Step 3: Try Solscan API (free, no auth)
  try {
    const solscanResponse = await axios.get(
      `https://api.solscan.io/token/meta?token=${tokenAddress}`,
      {
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'application/json',
        },
        validateStatus: (status) => status < 500,
      }
    );

    if (
      solscanResponse.data &&
      typeof solscanResponse.data === 'object' &&
      !solscanResponse.data.toString().startsWith('<!')
    ) {
      const data = solscanResponse.data.data || solscanResponse.data;
      if (data && (data.name || data.symbol)) {
        console.log(`   ✅ Found in Solscan: ${data.name || 'N/A'} (${data.symbol || 'N/A'})`);
        return {
          name: data.name || `Token ${tokenAddress}`,
          symbol: data.symbol || tokenAddress.toUpperCase(),
        };
      }
    }
    console.log(`   ❌ Not found in Solscan`);
  } catch (error: any) {
    console.log(`   ❌ Solscan error: ${error.response?.status || error.message}`);
  }

  // Step 4: Try Birdeye if API key is available
  if (BIRDEYE_API_KEY) {
    try {
      const response = await axios.get(
        'https://public-api.birdeye.so/defi/v3/token/meta-data/single',
        {
          headers: {
            'X-API-KEY': BIRDEYE_API_KEY,
            accept: 'application/json',
            'x-chain': chain,
          },
          params: {
            address: tokenAddress,
          },
          timeout: 5000,
        }
      );

      if (response.data?.success && response.data?.data) {
        const data = response.data.data;
        console.log(`   ✅ Found in Birdeye: ${data.name || 'N/A'} (${data.symbol || 'N/A'})`);
        return {
          name: data.name || `Token ${tokenAddress}`,
          symbol: data.symbol || tokenAddress.toUpperCase(),
        };
      }
      console.log(`   ❌ Not found in Birdeye`);
    } catch (error: any) {
      console.log(`   ❌ Birdeye error: ${error.response?.status || error.message}`);
    }
  }

  // Fallback to default
  console.log(
    `   ⚠️  Using fallback: Token ${tokenAddress} (${tokenAddress.toUpperCase()})`
  );
  return {
    name: `Token ${tokenAddress}`,
    symbol: tokenAddress.toUpperCase(),
  };
}

async function main() {
  console.log('🧪 Testing Token Metadata Fetching\n');
  console.log(`Testing ${TEST_TOKENS.length} token addresses...\n`);

  for (const tokenAddress of TEST_TOKENS) {
    const result = await fetchTokenMetadata(tokenAddress, 'solana');
    console.log(`\n📊 Result: ${result.name} (${result.symbol})`);
    console.log('─'.repeat(60));

    // Small delay between requests
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log('\n✅ Test complete!');
}

if (require.main === module) {
  main().catch(console.error);
}
