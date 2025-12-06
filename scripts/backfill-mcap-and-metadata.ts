#!/usr/bin/env ts-node

/**
 * Backfill MCAP and Metadata for Tokens in Database
 * 
 * Uses intelligent fallback chain:
 * 1. Pump.fun/bonk detection (instant)
 * 2. Birdeye API (accurate)
 * 3. Message extraction (from stored alert text)
 * 4. Infer from current data
 * 
 * Updates:
 * - entry_mcap field
 * - token metadata (symbol, name, decimals, etc.)
 */

import { Database } from 'sqlite3';
import { promisify } from 'util';
import { DateTime } from 'luxon';
import * as path from 'path';
import { 
  getEntryMcapWithFallback, 
  isPumpOrBonkToken,
  calculatePumpBonkMcap,
  formatMcap,
  extractMcapFromMessage
} from '../packages/web/lib/services/mcap-calculator';

const DB_PATH = process.env.CALLER_DB_PATH || path.join(process.cwd(), 'data', 'caller_alerts.db');
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || process.env.BIRDEYE_API_KEY_1;

interface TokenCall {
  id: number;
  caller_name: string;
  token_address: string;
  token_symbol: string | null;
  chain: string;
  alert_timestamp: string;
  alert_message: string | null;
  price_at_alert: number | null;
  entry_mcap: number | null;
}

interface TokenMetadata {
  symbol?: string;
  name?: string;
  decimals?: number;
  mc?: number;  // Current market cap
  price?: number;  // Current price
  logoURI?: string;
  v24hUSD?: number;  // 24h volume
  v24hChangePercent?: number;  // 24h price change
}

/**
 * Fetch token metadata from Birdeye
 */
async function fetchBirdeyeMetadata(
  tokenAddress: string,
  chain: string = 'solana'
): Promise<TokenMetadata | null> {
  if (!BIRDEYE_API_KEY) {
    console.warn('⚠️ No Birdeye API key available');
    return null;
  }

  try {
    const response = await fetch(
      `https://public-api.birdeye.so/defi/v3/token/meta-data/single?address=${tokenAddress}`,
      {
        headers: {
          'X-API-KEY': BIRDEYE_API_KEY,
        },
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`  ℹ️ Token not found in Birdeye: ${tokenAddress.substring(0, 12)}...`);
      } else if (response.status === 429) {
        console.warn('  ⚠️ Rate limited by Birdeye, waiting...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      return null;
    }

    const data: any = await response.json();
    
    if (data.success && data.data) {
      return {
        symbol: data.data.symbol,
        name: data.data.name,
        decimals: data.data.decimals,
        mc: data.data.mc,
        price: data.data.price,
        logoURI: data.data.logoURI,
        v24hUSD: data.data.v24hUSD,
        v24hChangePercent: data.data.v24hChangePercent,
      };
    }

    return null;
  } catch (error) {
    console.error(`  ❌ Error fetching metadata:`, error);
    return null;
  }
}

/**
 * Get all tokens that need MCAP or metadata
 */
async function getTokensNeedingUpdate(db: Database): Promise<TokenCall[]> {
  const all = promisify(db.all.bind(db)) as (query: string) => Promise<TokenCall[]>;
  
  const query = `
    SELECT 
      id,
      caller_name,
      token_address,
      token_symbol,
      chain,
      alert_timestamp,
      alert_message,
      price_at_alert,
      entry_mcap
    FROM caller_alerts
    WHERE entry_mcap IS NULL 
       OR token_symbol IS NULL
       OR token_symbol = 'UNKNOWN'
    ORDER BY alert_timestamp DESC
  `;
  
  return await all(query);
}

/**
 * Update token with MCAP and metadata
 */
async function updateTokenData(
  db: Database,
  callId: number,
  entryMcap: number | null,
  metadata: TokenMetadata | null
): Promise<void> {
  const run = promisify(db.run.bind(db)) as (query: string, params: any[]) => Promise<void>;
  
  const updates: string[] = [];
  const params: any[] = [];
  
  if (entryMcap !== null) {
    updates.push('entry_mcap = ?');
    params.push(entryMcap);
  }
  
  if (metadata) {
    if (metadata.symbol) {
      updates.push('token_symbol = ?');
      params.push(metadata.symbol);
    }
  }
  
  if (updates.length === 0) {
    return;
  }
  
  params.push(callId);
  
  const query = `UPDATE caller_alerts SET ${updates.join(', ')} WHERE id = ?`;
  await run(query, params);
}

/**
 * Store metadata in separate table for caching
 */
async function storeMetadataCache(
  db: Database,
  tokenAddress: string,
  metadata: TokenMetadata
): Promise<void> {
  const run = promisify(db.run.bind(db)) as (query: string, params?: any[]) => Promise<void>;
  
  try {
    // Create metadata table if it doesn't exist
    await run(`
      CREATE TABLE IF NOT EXISTS token_metadata (
        token_address TEXT PRIMARY KEY,
        symbol TEXT,
        name TEXT,
        decimals INTEGER,
        current_mcap REAL,
        current_price REAL,
        logo_uri TEXT,
        volume_24h REAL,
        price_change_24h REAL,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    const query = `
      INSERT OR REPLACE INTO token_metadata 
      (token_address, symbol, name, decimals, current_mcap, current_price, logo_uri, volume_24h, price_change_24h, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `;
    
    await run(query, [
      tokenAddress,
      metadata.symbol || null,
      metadata.name || null,
      metadata.decimals || null,
      metadata.mc || null,
      metadata.price || null,
      metadata.logoURI || null,
      metadata.v24hUSD || null,
      metadata.v24hChangePercent || null
    ]);
  } catch (error) {
    console.error('  ❌ Error storing metadata cache:', error);
  }
}

/**
 * Process a single token call
 */
async function processToken(
  db: Database,
  call: TokenCall,
  stats: {
    processed: number;
    mcapFromPump: number;
    mcapFromBirdeye: number;
    mcapFromMessage: number;
    mcapFromInfer: number;
    mcapFailed: number;
    metadataFetched: number;
    metadataFailed: number;
  }
): Promise<void> {
  stats.processed++;
  
  const mintShort = call.token_address.substring(0, 12);
  console.log(`\n[${stats.processed}] ${mintShort}... by ${call.caller_name}`);
  
  let entryMcap = call.entry_mcap;
  let metadata: TokenMetadata | null = null;
  
  // Step 1: Fetch MCAP if missing
  if (!entryMcap && call.price_at_alert) {
    // Try fallback chain
    const alertTime = DateTime.fromISO(call.alert_timestamp);
    
    // Check pump/bonk first (fastest)
    if (isPumpOrBonkToken(call.token_address)) {
      entryMcap = calculatePumpBonkMcap(call.price_at_alert);
      console.log(`  ✅ Pump/bonk MCAP: ${formatMcap(entryMcap)}`);
      stats.mcapFromPump++;
    } else {
      // Try Birdeye
      metadata = await fetchBirdeyeMetadata(call.token_address, call.chain);
      
      if (metadata?.mc) {
        // Infer entry MCAP from current MCAP
        if (metadata.price && call.price_at_alert) {
          entryMcap = metadata.mc * (call.price_at_alert / metadata.price);
          console.log(`  ✅ Inferred MCAP: ${formatMcap(entryMcap)} (from current ${formatMcap(metadata.mc)})`);
          stats.mcapFromInfer++;
        } else {
          // Use current MCAP as approximation
          entryMcap = metadata.mc;
          console.log(`  ⚠️ Using current MCAP: ${formatMcap(entryMcap)} (no price data to infer)`);
          stats.mcapFromBirdeye++;
        }
      } else if (call.alert_message) {
        // Try extracting from message
        const extractedMcap = extractMcapFromMessage(call.alert_message);
        
        if (extractedMcap) {
          entryMcap = extractedMcap;
          console.log(`  ✅ Extracted MCAP from message: ${formatMcap(entryMcap)}`);
          stats.mcapFromMessage++;
        } else {
          console.log(`  ❌ Could not fetch MCAP`);
          stats.mcapFailed++;
        }
      } else {
        console.log(`  ❌ No MCAP available`);
        stats.mcapFailed++;
      }
      
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
  
  // Step 2: Fetch metadata if missing or if we haven't fetched it yet
  if ((!call.token_symbol || call.token_symbol === 'UNKNOWN') && !metadata) {
    metadata = await fetchBirdeyeMetadata(call.token_address, call.chain);
    
    if (metadata) {
      console.log(`  ✅ Fetched metadata: ${metadata.symbol || 'N/A'} - ${metadata.name || 'N/A'}`);
      stats.metadataFetched++;
    } else {
      console.log(`  ⚠️ Metadata not available`);
      stats.metadataFailed++;
    }
    
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  
  // Step 3: Update database
  if (entryMcap || metadata) {
    await updateTokenData(db, call.id, entryMcap, metadata);
    
    // Store metadata in cache table
    if (metadata) {
      await storeMetadataCache(db, call.token_address, metadata);
    }
  }
}

/**
 * Main backfill process
 */
async function backfillMcapAndMetadata(): Promise<void> {
  console.log('🚀 Starting MCAP and Metadata Backfill\n');
  console.log('='.repeat(60));
  
  // Open database
  const db = new Database(DB_PATH);
  
  // Get tokens needing updates
  const tokens = await getTokensNeedingUpdate(db);
  console.log(`\n📊 Found ${tokens.length} tokens needing updates\n`);
  
  if (tokens.length === 0) {
    console.log('✅ All tokens already have MCAP and metadata!');
    db.close();
    return;
  }
  
  // Process tokens
  const stats = {
    processed: 0,
    mcapFromPump: 0,
    mcapFromBirdeye: 0,
    mcapFromMessage: 0,
    mcapFromInfer: 0,
    mcapFailed: 0,
    metadataFetched: 0,
    metadataFailed: 0,
  };
  
  const startTime = Date.now();
  
  for (const token of tokens) {
    try {
      await processToken(db, token, stats);
    } catch (error) {
      console.error(`\n❌ Error processing ${token.token_address.substring(0, 12)}:`, error);
    }
    
    // Progress update every 10 tokens
    if (stats.processed % 10 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = (stats.processed / (Date.now() - startTime) * 1000).toFixed(1);
      console.log(`\n📈 Progress: ${stats.processed}/${tokens.length} (${rate}/s, ${elapsed}s elapsed)`);
    }
  }
  
  // Final report
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  
  console.log('\n' + '='.repeat(60));
  console.log('\n✅ Backfill Complete!\n');
  console.log('📊 MCAP Results:');
  console.log(`  ⚡ Pump/bonk (instant):  ${stats.mcapFromPump}`);
  console.log(`  🌐 Birdeye API:          ${stats.mcapFromBirdeye}`);
  console.log(`  💬 Message extraction:   ${stats.mcapFromMessage}`);
  console.log(`  🔄 Inferred from current: ${stats.mcapFromInfer}`);
  console.log(`  ❌ Failed:               ${stats.mcapFailed}`);
  
  const mcapSuccess = stats.mcapFromPump + stats.mcapFromBirdeye + stats.mcapFromMessage + stats.mcapFromInfer;
  const mcapTotal = mcapSuccess + stats.mcapFailed;
  const mcapRate = mcapTotal > 0 ? ((mcapSuccess / mcapTotal) * 100).toFixed(1) : '0';
  console.log(`  📈 Success rate:         ${mcapRate}%`);
  
  console.log('\n📊 Metadata Results:');
  console.log(`  ✅ Fetched:              ${stats.metadataFetched}`);
  console.log(`  ❌ Failed:               ${stats.metadataFailed}`);
  
  const metaTotal = stats.metadataFetched + stats.metadataFailed;
  const metaRate = metaTotal > 0 ? ((stats.metadataFetched / metaTotal) * 100).toFixed(1) : '0';
  console.log(`  📈 Success rate:         ${metaRate}%`);
  
  console.log(`\n⏱️  Total time: ${totalTime}s`);
  console.log(`📊 Processed: ${stats.processed} tokens`);
  
  db.close();
  
  console.log('\n✨ Done!\n');
}

// Run if called directly
if (require.main === module) {
  backfillMcapAndMetadata()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('\n❌ Fatal error:', error);
      process.exit(1);
    });
}

export { backfillMcapAndMetadata };

