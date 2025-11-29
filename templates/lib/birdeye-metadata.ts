import axios from 'axios'

export interface TokenMetadata {
  name: string
  symbol: string
  decimals?: number
  price?: number
}

// Try multiple API keys in order
// Priority: BIRDEYE_API_KEY_1 > BIRDEYE_API_KEY > hardcoded fallback
const getApiKey = (): string => {
  const key1 = process.env.BIRDEYE_API_KEY_1?.trim()
  if (key1) return key1
  
  const key = process.env.BIRDEYE_API_KEY?.trim()
  if (key) return key
  
  // Fallback to new API key (user provided)
  return '8d0804d5859c4fac83ca5bc3a21daed2'
}

const BIRDEYE_API_KEY = getApiKey()

// Cache for metadata to avoid repeated API calls
const metadataCache = new Map<string, TokenMetadata>()

// Rate limiter: 900 RPM = 15 requests per second = ~67ms minimum between requests
// We'll use 70ms to be safe
const MIN_DELAY_MS = 70
const MAX_REQUESTS_PER_MINUTE = 900

// Track request timestamps for rate limiting
const requestTimestamps: number[] = []

/**
 * Rate limiter to ensure we don't exceed 900 RPM
 */
async function rateLimit(): Promise<void> {
  const now = Date.now()
  
  // Remove timestamps older than 1 minute
  while (requestTimestamps.length > 0 && requestTimestamps[0] < now - 60000) {
    requestTimestamps.shift()
  }
  
  // If we're at the limit, wait until we can make another request
  if (requestTimestamps.length >= MAX_REQUESTS_PER_MINUTE) {
    const oldestRequest = requestTimestamps[0]
    const waitTime = 60000 - (now - oldestRequest) + 100 // Add 100ms buffer
    if (waitTime > 0) {
      await new Promise(resolve => setTimeout(resolve, waitTime))
      return rateLimit() // Recursively check again
    }
  }
  
  // Ensure minimum delay between requests
  if (requestTimestamps.length > 0) {
    const lastRequest = requestTimestamps[requestTimestamps.length - 1]
    const timeSinceLastRequest = now - lastRequest
    if (timeSinceLastRequest < MIN_DELAY_MS) {
      await new Promise(resolve => setTimeout(resolve, MIN_DELAY_MS - timeSinceLastRequest))
    }
  }
  
  // Record this request
  requestTimestamps.push(Date.now())
}

/**
 * Fetch token metadata from Birdeye API
 */
export async function fetchTokenMetadata(
  tokenAddress: string,
  chain: string = 'solana'
): Promise<TokenMetadata | null> {
  // Check cache first
  const cacheKey = `${chain}:${tokenAddress}`
  if (metadataCache.has(cacheKey)) {
    return metadataCache.get(cacheKey)!
  }

  if (!BIRDEYE_API_KEY) {
    console.warn('No Birdeye API key found, returning default metadata')
    return {
      name: `Token ${tokenAddress.substring(0, 8)}`,
      symbol: tokenAddress.substring(0, 4).toUpperCase(),
    }
  }

  // Apply rate limiting
  await rateLimit()

  try {
    const response = await axios.get(
      'https://public-api.birdeye.so/defi/v3/token/meta-data/single',
      {
        headers: {
          'X-API-KEY': BIRDEYE_API_KEY,
          'accept': 'application/json',
          'x-chain': chain,
        },
        params: {
          address: tokenAddress,
        },
        timeout: 5000,
      }
    )

    if (response.data?.success && response.data?.data) {
      const metadata: TokenMetadata = {
        name: response.data.data.name || `Token ${tokenAddress.substring(0, 8)}`,
        symbol: response.data.data.symbol || tokenAddress.substring(0, 4).toUpperCase(),
        decimals: response.data.data.decimals,
        price: response.data.data.price,
      }

      // Cache the result
      metadataCache.set(cacheKey, metadata)
      return metadata
    }
  } catch (error: any) {
    // Handle 403 (Forbidden) - API key issue or rate limit
    if (error.response?.status === 403) {
      // Cache a default result to avoid repeated failed calls
      const defaultMetadata: TokenMetadata = {
        name: `Token ${tokenAddress.substring(0, 8)}`,
        symbol: tokenAddress.substring(0, 4).toUpperCase(),
      }
      metadataCache.set(cacheKey, defaultMetadata)
      // Don't log 403 errors - they're expected when API key is invalid/rate-limited
      return defaultMetadata
    }
    
    if (error.response?.status === 404) {
      // Token not found - cache null result
      const defaultMetadata: TokenMetadata = {
        name: `Token ${tokenAddress.substring(0, 8)}`,
        symbol: tokenAddress.substring(0, 4).toUpperCase(),
      }
      metadataCache.set(cacheKey, defaultMetadata)
      return defaultMetadata
    }
    
    // Only log non-403/404 errors
    if (error.response?.status !== 403 && error.response?.status !== 404) {
      console.error(`Error fetching metadata for ${tokenAddress}:`, error.message)
    }
  }

  // Return default on error
  const defaultMetadata: TokenMetadata = {
    name: `Token ${tokenAddress.substring(0, 8)}`,
    symbol: tokenAddress.substring(0, 4).toUpperCase(),
  }
  metadataCache.set(cacheKey, defaultMetadata)
  return defaultMetadata
}

/**
 * Batch fetch metadata for multiple tokens (with rate limiting)
 * Rate limiting is handled internally by fetchTokenMetadata, so no additional delay needed
 */
export async function fetchTokenMetadataBatch(
  tokens: Array<{ address: string; chain?: string }>,
  delayMs: number = 0 // No additional delay - rate limiting handled internally
): Promise<Map<string, TokenMetadata>> {
  const results = new Map<string, TokenMetadata>()

  for (const token of tokens) {
    const metadata = await fetchTokenMetadata(token.address, token.chain || 'solana')
    if (metadata) {
      results.set(token.address, metadata)
    }
    // Rate limiting is already handled in fetchTokenMetadata via rateLimit()
  }

  return results
}

