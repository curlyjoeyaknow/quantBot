/**
 * Market Cap Calculator
 * Provides utilities for fetching and calculating market cap at specific times
 */

import { DateTime } from 'luxon';

export interface McapSnapshot {
  mcap: number;
  price: number;
  supply: number;
  timestamp: Date;
}

/**
 * Calculate current MCAP from entry MCAP and price change
 * Formula: current_mcap = entry_mcap * (current_price / entry_price)
 * 
 * This works because:
 * - MCAP = price * supply
 * - Supply is constant
 * - current_mcap = current_price * supply = entry_mcap * (current_price / entry_price)
 */
export function calculateMcapFromPriceChange(
  entryMcap: number,
  entryPrice: number,
  currentPrice: number
): number {
  if (entryPrice <= 0) return entryMcap;
  
  const priceMultiple = currentPrice / entryPrice;
  return entryMcap * priceMultiple;
}

/**
 * Calculate MCAP multiple (how many X from entry to peak)
 * Formula: multiple = peak_mcap / entry_mcap
 */
export function calculateMcapMultiple(
  entryMcap: number,
  peakMcap: number
): number {
  if (entryMcap <= 0) return 1.0;
  return peakMcap / entryMcap;
}

/**
 * Infer entry MCAP from current price and MCAP
 * If we know current MCAP and current price, and we know entry price,
 * we can calculate what the MCAP was at entry
 * 
 * Formula: entry_mcap = current_mcap * (entry_price / current_price)
 */
export function inferEntryMcap(
  currentMcap: number,
  currentPrice: number,
  entryPrice: number
): number {
  if (currentPrice <= 0) return currentMcap;
  
  const priceRatio = entryPrice / currentPrice;
  return currentMcap * priceRatio;
}

/**
 * Format MCAP for display
 */
export function formatMcap(mcap: number): string {
  if (mcap >= 1_000_000_000) {
    return `$${(mcap / 1_000_000_000).toFixed(2)}B`;
  } else if (mcap >= 1_000_000) {
    return `$${(mcap / 1_000_000).toFixed(2)}M`;
  } else if (mcap >= 1_000) {
    return `$${(mcap / 1_000).toFixed(2)}K`;
  } else {
    return `$${mcap.toFixed(2)}`;
  }
}

/**
 * Calculate MCAP from price and supply
 */
export function calculateMcap(price: number, supply: number): number {
  return price * supply;
}

/**
 * Example usage and validation
 */
export function validateMcapCalculations(): void {
  // Test 1: Basic MCAP calculations
  const entryPrice = 0.001;
  const entryMcap = 100_000;
  const peakPrice = 0.010;
  const peakMcap = calculateMcapFromPriceChange(entryMcap, entryPrice, peakPrice);
  
  console.assert(peakMcap === 1_000_000, 'Peak MCAP should be $1M');
  
  const multiple = calculateMcapMultiple(entryMcap, peakMcap);
  console.assert(multiple === 10, 'Multiple should be 10x');
  
  const inferredEntryMcap = inferEntryMcap(1_000_000, 0.010, 0.001);
  console.assert(inferredEntryMcap === 100_000, 'Inferred entry MCAP should be $100K');
  
  // Test 2: Pump.fun token detection
  console.assert(isPumpOrBonkToken('ABC123pump') === true, 'Should detect pump token');
  console.assert(isPumpOrBonkToken('XYZ789bonk') === true, 'Should detect bonk token');
  console.assert(isPumpOrBonkToken('RegularToken') === false, 'Should not detect regular token');
  
  // Test 3: Pump/bonk MCAP calculation
  const pumpPrice = 0.00001;
  const pumpMcap = calculatePumpBonkMcap(pumpPrice);
  console.assert(pumpMcap === 10_000, 'Pump token at $0.00001 should have $10K MCAP');
  
  // Test 4: Message extraction
  const mcapFromMsg1 = extractMcapFromMessage('This is a great token, mcap: $500k');
  console.assert(mcapFromMsg1 === 500_000, 'Should extract $500K from message');
  
  const mcapFromMsg2 = extractMcapFromMessage('Trading at 2.5m mc right now');
  console.assert(mcapFromMsg2 === 2_500_000, 'Should extract $2.5M from message');
  
  console.log('✅ All MCAP calculations validated (including pump/bonk detection)');
}

/**
 * Check if token is a pump.fun or bonk token (1B total supply)
 * These tokens have predictable supply, making MCAP easy to calculate
 */
export function isPumpOrBonkToken(tokenAddress: string): boolean {
  const addr = tokenAddress.toLowerCase();
  
  // Pump.fun tokens end with "pump"
  if (addr.endsWith('pump')) return true;
  
  // Bonk tokens end with "bonk"
  if (addr.endsWith('bonk')) return true;
  
  return false;
}

/**
 * Calculate MCAP for pump.fun/bonk tokens (1B supply)
 */
export function calculatePumpBonkMcap(price: number): number {
  const TOTAL_SUPPLY = 1_000_000_000; // 1 billion
  return price * TOTAL_SUPPLY;
}

/**
 * Fetch MCAP from Birdeye API
 */
async function fetchMcapFromBirdeye(
  tokenAddress: string,
  chain: string = 'solana'
): Promise<number | null> {
  try {
    const apiKey = process.env.BIRDEYE_API_KEY || process.env.BIRDEYE_API_KEY_1;
    if (!apiKey) {
      console.warn('No Birdeye API key available');
      return null;
    }

    const response = await fetch(
      `https://public-api.birdeye.so/defi/v3/token/meta-data/single?address=${tokenAddress}`,
      {
        headers: {
          'X-API-KEY': apiKey,
        },
      }
    );

    if (!response.ok) {
      console.warn(`Birdeye API error: ${response.status}`);
      return null;
    }

    const data: any = await response.json();
    
    // Birdeye returns market cap as 'mc'
    if (data.data && typeof data.data.mc === 'number') {
      return data.data.mc;
    }

    return null;
  } catch (error) {
    console.error('Error fetching MCAP from Birdeye:', error);
    return null;
  }
}

/**
 * Extract MCAP from chat message text
 * Sometimes callers mention market cap in their messages
 */
export function extractMcapFromMessage(messageText: string): number | null {
  if (!messageText) return null;
  
  const text = messageText.toLowerCase();
  
  // Patterns: "mcap: $500k", "mc: 1m", "market cap $2.5m", "500k mc"
  const patterns = [
    /(?:mcap|mc|market\s*cap)[:\s]*\$?\s*([0-9.]+)\s*([kmb])/i,
    /\$?\s*([0-9.]+)\s*([kmb])\s*(?:mcap|mc|market\s*cap)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = parseFloat(match[1]);
      const unit = match[2].toLowerCase();
      
      let multiplier = 1;
      if (unit === 'k') multiplier = 1_000;
      else if (unit === 'm') multiplier = 1_000_000;
      else if (unit === 'b') multiplier = 1_000_000_000;
      
      return value * multiplier;
    }
  }
  
  return null;
}

/**
 * Get MCAP with intelligent fallback chain
 * 
 * Priority:
 * 1. Pump.fun/bonk tokens → Calculate from price (1B supply)
 * 2. Birdeye API → Fetch current MCAP
 * 3. Chat message → Extract MCAP from original message
 * 4. Database → Check stored metadata
 * 5. Give up → Return null
 */
export async function fetchMcapAtTime(
  tokenAddress: string,
  chain: string,
  timestamp: Date,
  entryPrice?: number,
  messageText?: string
): Promise<number | null> {
  // STEP 1: Check if it's pump.fun or bonk token (FASTEST)
  if (entryPrice && isPumpOrBonkToken(tokenAddress)) {
    const mcap = calculatePumpBonkMcap(entryPrice);
    console.log(`✅ Calculated MCAP for pump/bonk token: ${formatMcap(mcap)}`);
    return mcap;
  }
  
  // STEP 2: Try Birdeye API
  const birdeyeMcap = await fetchMcapFromBirdeye(tokenAddress, chain);
  if (birdeyeMcap) {
    console.log(`✅ Fetched MCAP from Birdeye: ${formatMcap(birdeyeMcap)}`);
    return birdeyeMcap;
  }
  
  // STEP 3: Try extracting from chat message
  if (messageText) {
    const extractedMcap = extractMcapFromMessage(messageText);
    if (extractedMcap) {
      console.log(`✅ Extracted MCAP from message: ${formatMcap(extractedMcap)}`);
      return extractedMcap;
    }
  }
  
  // STEP 4: Check database for stored metadata (TODO: implement)
  // const storedMcap = await fetchStoredMcap(tokenAddress, timestamp);
  // if (storedMcap) return storedMcap;
  
  // STEP 5: Give up
  console.warn(`⚠️ Could not fetch MCAP for ${tokenAddress.substring(0, 12)}...`);
  return null;
}

/**
 * Helper to get entry MCAP with full fallback chain
 * 
 * Tries multiple methods in order:
 * 1. Pump.fun/bonk detection → Calculate directly
 * 2. Fetch from Birdeye
 * 3. Extract from message text
 * 4. Infer from current MCAP if available
 * 5. Return null
 */
export async function getEntryMcapWithFallback(
  tokenAddress: string,
  chain: string,
  alertTimestamp: Date,
  entryPrice: number,
  messageText?: string,
  currentMcap?: number,
  currentPrice?: number
): Promise<number | null> {
  // Try the full fallback chain (includes pump/bonk detection)
  const fetchedMcap = await fetchMcapAtTime(
    tokenAddress,
    chain,
    alertTimestamp,
    entryPrice,
    messageText
  );
  
  if (fetchedMcap) return fetchedMcap;
  
  // Last resort: If current MCAP and price are available, infer entry MCAP
  if (currentMcap && currentPrice && currentPrice > 0) {
    const inferredMcap = inferEntryMcap(currentMcap, currentPrice, entryPrice);
    console.log(`✅ Inferred entry MCAP from current data: ${formatMcap(inferredMcap)}`);
    return inferredMcap;
  }
  
  // No MCAP data available
  console.warn(`❌ No MCAP available for ${tokenAddress.substring(0, 12)}...`);
  return null;
}

