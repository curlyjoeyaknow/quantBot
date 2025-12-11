/**
 * Market Cap Calculator
 * Provides utilities for fetching and calculating market cap at specific times
 */
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
export declare function calculateMcapFromPriceChange(entryMcap: number, entryPrice: number, currentPrice: number): number;
/**
 * Calculate MCAP multiple (how many X from entry to peak)
 * Formula: multiple = peak_mcap / entry_mcap
 */
export declare function calculateMcapMultiple(entryMcap: number, peakMcap: number): number;
/**
 * Infer entry MCAP from current price and MCAP
 * If we know current MCAP and current price, and we know entry price,
 * we can calculate what the MCAP was at entry
 *
 * Formula: entry_mcap = current_mcap * (entry_price / current_price)
 */
export declare function inferEntryMcap(currentMcap: number, currentPrice: number, entryPrice: number): number;
/**
 * Format MCAP for display
 */
export declare function formatMcap(mcap: number): string;
/**
 * Calculate MCAP from price and supply
 */
export declare function calculateMcap(price: number, supply: number): number;
/**
 * Example usage and validation
 */
export declare function validateMcapCalculations(): void;
/**
 * Check if token is a pump.fun or bonk token (1B total supply)
 * These tokens have predictable supply, making MCAP easy to calculate
 */
export declare function isPumpOrBonkToken(tokenAddress: string): boolean;
/**
 * Calculate MCAP for pump.fun/bonk tokens (1B supply)
 */
export declare function calculatePumpBonkMcap(price: number): number;
/**
 * Extract MCAP from chat message text
 * Sometimes callers mention market cap in their messages
 */
export declare function extractMcapFromMessage(messageText: string): number | null;
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
export declare function fetchMcapAtTime(tokenAddress: string, chain: string, timestamp: Date, entryPrice?: number, messageText?: string): Promise<number | null>;
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
export declare function getEntryMcapWithFallback(tokenAddress: string, chain: string, alertTimestamp: Date, entryPrice: number, messageText?: string, currentMcap?: number, currentPrice?: number): Promise<number | null>;
//# sourceMappingURL=mcap-calculator.d.ts.map