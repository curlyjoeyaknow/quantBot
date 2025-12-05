import axios from 'axios';
import { cache, cacheKeys } from './cache';
import { CONSTANTS } from './constants';

const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || '';
const BIRDEYE_API_BASE = 'https://public-api.birdeye.so';

// Rate limiter
class RateLimiter {
  private requests: number[] = [];
  private maxRequests: number;
  private windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  async waitIfNeeded(): Promise<void> {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < this.windowMs);

    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = this.requests[0];
      const waitTime = this.windowMs - (now - oldestRequest);
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      this.requests = this.requests.filter(time => Date.now() - time < this.windowMs);
    }

    this.requests.push(Date.now());
  }
}

const rateLimiter = new RateLimiter(
  CONSTANTS.BIRDEYE_RATE_LIMIT.REQUESTS_PER_SECOND,
  1000 // 1 second window
);

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      if (attempt < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('Request failed after retries');
}

export async function getCurrentPrice(tokenAddress: string, chain: string): Promise<number | null> {
  const cacheKey = cacheKeys.currentPrice(tokenAddress, chain);
  const cached = cache.get<number>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  try {
    await rateLimiter.waitIfNeeded();

    const chainHeader = chain === 'solana' ? 'solana' : chain;
    
    const response = await retryWithBackoff(async () => {
      return await axios.get(`${BIRDEYE_API_BASE}/defi/token_overview`, {
        headers: {
          'X-API-KEY': BIRDEYE_API_KEY,
          'accept': 'application/json',
          'x-chain': chainHeader
        },
        params: { address: tokenAddress },
        timeout: 5000
      });
    });
    
    if (response.data.success && response.data.data) {
      const price = response.data.data.price || null;
      if (price !== null) {
        cache.set(cacheKey, price, CONSTANTS.CACHE_TTL.CURRENT_PRICE);
      }
      return price;
    }
    return null;
  } catch (error) {
    console.error(`Error fetching current price for ${tokenAddress}:`, error);
    return null;
  }
}

// Batch get current prices (with rate limiting)
export async function getCurrentPricesBatch(
  requests: Array<{ tokenAddress: string; chain: string }>
): Promise<Map<string, number | null>> {
  const results = new Map<string, number | null>();
  const uncached: typeof requests = [];

  // Check cache first
  for (const req of requests) {
    const cacheKey = cacheKeys.currentPrice(req.tokenAddress, req.chain);
    const cached = cache.get<number>(cacheKey);
    if (cached !== null) {
      results.set(`${req.chain}:${req.tokenAddress}`, cached);
    } else {
      uncached.push(req);
    }
  }

  // Fetch uncached items with rate limiting
  for (const req of uncached) {
    const price = await getCurrentPrice(req.tokenAddress, req.chain);
    results.set(`${req.chain}:${req.tokenAddress}`, price);
  }

  return results;
}

