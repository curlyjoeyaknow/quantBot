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
  // Example: Token entry at $0.001 with $100K MCAP
  const entryPrice = 0.001;
  const entryMcap = 100_000;
  
  // Peak at $0.010 (10x price)
  const peakPrice = 0.010;
  const peakMcap = calculateMcapFromPriceChange(entryMcap, entryPrice, peakPrice);
  
  console.assert(peakMcap === 1_000_000, 'Peak MCAP should be $1M');
  
  const multiple = calculateMcapMultiple(entryMcap, peakMcap);
  console.assert(multiple === 10, 'Multiple should be 10x');
  
  // Reverse calculation: if we know current MCAP is $1M at price $0.010
  // and entry was at $0.001, what was entry MCAP?
  const inferredEntryMcap = inferEntryMcap(1_000_000, 0.010, 0.001);
  console.assert(inferredEntryMcap === 100_000, 'Inferred entry MCAP should be $100K');
  
  console.log('✅ All MCAP calculations validated');
}

/**
 * Get MCAP from token metadata (Birdeye API or database)
 * This should be called at the time of the alert to get entry MCAP
 */
export async function fetchMcapAtTime(
  tokenAddress: string,
  chain: string,
  timestamp: Date
): Promise<number | null> {
  // TODO: Implement actual API call to Birdeye or database query
  // For now, return null to indicate MCAP should be fetched from metadata
  
  // Example implementation:
  // 1. Check database for stored MCAP at alert time
  // 2. If not found, fetch from Birdeye historical data
  // 3. If historical data not available, infer from current MCAP and price ratio
  
  return null;
}

/**
 * Helper to get entry MCAP with fallback to price-based estimation
 */
export async function getEntryMcapWithFallback(
  tokenAddress: string,
  chain: string,
  alertTimestamp: Date,
  entryPrice: number,
  currentMcap?: number,
  currentPrice?: number
): Promise<number | null> {
  // Try to fetch stored MCAP
  const storedMcap = await fetchMcapAtTime(tokenAddress, chain, alertTimestamp);
  if (storedMcap) return storedMcap;
  
  // If current MCAP and price are available, infer entry MCAP
  if (currentMcap && currentPrice && currentPrice > 0) {
    return inferEntryMcap(currentMcap, currentPrice, entryPrice);
  }
  
  // No MCAP data available
  return null;
}

