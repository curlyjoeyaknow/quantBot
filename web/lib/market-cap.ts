// Market cap calculation utilities

import axios from 'axios';
import { cache, cacheKeys } from './cache';
import { CONSTANTS } from './constants';

const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || '';
const BIRDEYE_API_BASE = 'https://public-api.birdeye.so';

interface TokenMetadata {
  price?: number;
  totalSupply?: number;
  marketCap?: number;
}

/**
 * Get token metadata including total supply
 * Tries multiple Birdeye endpoints for better coverage
 */
async function getTokenMetadata(tokenAddress: string, chain: string): Promise<TokenMetadata | null> {
  const chainHeader = chain === 'solana' ? 'solana' : chain;
  
  // Try token overview endpoint first (more reliable for market cap)
  try {
    const overviewResponse = await axios.get(`${BIRDEYE_API_BASE}/defi/token_overview`, {
      headers: {
        'X-API-KEY': BIRDEYE_API_KEY,
        'accept': 'application/json',
        'x-chain': chainHeader
      },
      params: { address: tokenAddress },
      timeout: 5000
    });
    
    if (overviewResponse.data.success && overviewResponse.data.data) {
      const data = overviewResponse.data.data;
      return {
        price: data.price || data.priceUsd,
        totalSupply: data.totalSupply,
        marketCap: data.marketCap || data.marketCapUsd,
      };
    }
  } catch (error) {
    // Continue to next endpoint
  }

  // Try metadata endpoint as fallback
  try {
    const metadataResponse = await axios.get(`${BIRDEYE_API_BASE}/defi/v3/token/meta-data/single`, {
      headers: {
        'X-API-KEY': BIRDEYE_API_KEY,
        'accept': 'application/json',
        'x-chain': chainHeader
      },
      params: { address: tokenAddress },
      timeout: 5000
    });
    
    if (metadataResponse.data.success && metadataResponse.data.data) {
      const data = metadataResponse.data.data;
      return {
        price: data.price || data.priceUsd,
        totalSupply: data.totalSupply,
        marketCap: data.marketCap || data.marketCapUsd,
      };
    }
  } catch (error) {
    // Continue to fallback logic
  }

  return null;
}

/**
 * Calculate market cap at a specific time
 * Uses historical price if available, otherwise estimates
 */
export async function calculateMarketCap(
  tokenAddress: string,
  chain: string,
  price: number,
  timestamp?: string
): Promise<number | null> {
  const cacheKey = cacheKeys.marketCap(tokenAddress, chain, timestamp || 'current');
  const cached = cache.get<number>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  // Try API first (if available), but don't fail if it's not
  try {
    const metadata = await getTokenMetadata(tokenAddress, chain);
    
    if (!metadata) {
      // Fallback to estimate if metadata is null
      const estimate = price * 1_000_000; // Rough estimate
      cache.set(cacheKey, estimate, CONSTANTS.CACHE_TTL.MARKET_CAP);
      return estimate;
    }
    
    // Use market cap from API if available (most accurate)
    if (metadata.marketCap && metadata.marketCap > 0) {
      cache.set(cacheKey, metadata.marketCap, CONSTANTS.CACHE_TTL.MARKET_CAP);
      return metadata.marketCap;
    }

    // Use actual total supply if available
    if (metadata.totalSupply && metadata.totalSupply > 0) {
      const marketCap = price * metadata.totalSupply;
      cache.set(cacheKey, marketCap, CONSTANTS.CACHE_TTL.MARKET_CAP);
      return marketCap;
    }
  } catch (error) {
    // API failed - continue to fallback
    console.log(`Market cap API unavailable for ${tokenAddress}, using estimate`);
  }

  // Fallback: estimate based on token address patterns and chain
  const addressLower = tokenAddress.toLowerCase();
  
  // Pump.fun tokens typically have 1B supply
  if (addressLower.includes('pump') || addressLower.includes('bonk') || 
      addressLower.includes('raydium') || addressLower.includes('orca')) {
    const marketCap = price * CONSTANTS.MARKET_CAP.PUMP_FUN_SUPPLY;
    cache.set(cacheKey, marketCap, CONSTANTS.CACHE_TTL.MARKET_CAP);
    return marketCap;
  }

  // For Solana tokens, use conservative estimate of 1B supply
  if (chain === 'solana') {
    const estimatedSupply = CONSTANTS.MARKET_CAP.PUMP_FUN_SUPPLY;
    const marketCap = price * estimatedSupply;
    cache.set(cacheKey, marketCap, CONSTANTS.CACHE_TTL.MARKET_CAP);
    return marketCap;
  }

  // Default fallback
  const estimatedSupply = CONSTANTS.MARKET_CAP.PUMP_FUN_SUPPLY;
  const marketCap = price * estimatedSupply;
  cache.set(cacheKey, marketCap, CONSTANTS.CACHE_TTL.MARKET_CAP);
  return marketCap;
}

/**
 * Batch calculate market caps
 */
export async function calculateMarketCapsBatch(
  requests: Array<{ tokenAddress: string; chain: string; price: number; timestamp?: string }>
): Promise<Map<string, number | null>> {
  const results = new Map<string, number | null>();

  for (const req of requests) {
    const key = `${req.chain}:${req.tokenAddress}:${req.timestamp || 'current'}`;
    const marketCap = await calculateMarketCap(req.tokenAddress, req.chain, req.price, req.timestamp);
    results.set(key, marketCap);
  }

  return results;
}

