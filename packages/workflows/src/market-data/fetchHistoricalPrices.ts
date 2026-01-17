/**
 * Fetch Historical Prices Workflow
 * =================================
 * Fetches historical prices from Birdeye API at exact timestamps.
 *
 * This is a workflow function (orchestration) that belongs in workflows
 * because it coordinates external API calls. Analytics should only read
 * from storage, not fetch from APIs.
 */

import { logger } from '@quantbot/infra/utils';
import { getBirdeyeClient } from '@quantbot/api-clients';
import { DateTime } from 'luxon';

/**
 * Detect chain from token address format
 * Returns the chain identifier for Birdeye API
 */
function detectChainFromAddress(address: string): string {
  const normalized = address.trim().toLowerCase();

  // EVM addresses start with 0x (Ethereum, Base, BSC)
  if (normalized.startsWith('0x')) {
    return 'ethereum'; // Birdeye uses 'ethereum' for all EVM chains
  }

  // Sui token format: long hex::module::name (not supported by Birdeye)
  if (normalized.includes('::')) {
    return 'solana'; // Default fallback, but likely won't work
  }

  // Default to Solana for most pump.fun and other tokens
  return 'solana';
}

/**
 * Normalize token address for Birdeye API
 * Extracts the actual address from complex formats
 */
function normalizeTokenAddress(address: string): string {
  // For Sui format like "0x...::module::name", extract just the hex part
  // Note: Birdeye likely doesn't support Sui, but we try anyway
  if (address.includes('::')) {
    const parts = address.split('::');
    return parts[0]?.trim() ?? address.trim();
  }

  return address.trim();
}

/**
 * Fetch historical price at exact timestamp using Birdeye API
 * Automatically detects chain from address format
 */
export async function fetchHistoricalPriceAtTime(
  tokenAddress: string,
  timestamp: Date | DateTime,
  chain?: string
): Promise<number | null> {
  try {
    const birdeyeClient = getBirdeyeClient();
    const alertTime = timestamp instanceof DateTime ? timestamp : DateTime.fromJSDate(timestamp);
    const unixTimestamp = Math.floor(alertTime.toSeconds());

    // Normalize address and detect chain if not provided
    const normalizedAddress = normalizeTokenAddress(tokenAddress);
    const detectedChain = chain || detectChainFromAddress(tokenAddress);

    const result = await birdeyeClient.fetchHistoricalPriceAtUnixTime(
      normalizedAddress,
      unixTimestamp,
      detectedChain
    );

    if (result?.value && result.value > 0 && Number.isFinite(result.value)) {
      logger.trace('[fetchHistoricalPrices] Fetched price from Birdeye', {
        token: normalizedAddress,
        chain: detectedChain,
        timestamp: unixTimestamp,
        price: result.value,
      });
      return result.value;
    }

    // Don't log trace for every missing price - reduce noise
    // Only log at debug level if needed for troubleshooting
    return null;
  } catch (error) {
    // Log errors but don't spam logs with trace messages
    logger.debug('[fetchHistoricalPrices] Error fetching historical price', {
      token: tokenAddress,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Fetch historical prices for multiple calls in batches
 * Returns a map of call index -> price
 * Each call gets its price at its exact alert timestamp
 */
export async function fetchHistoricalPricesBatch(
  calls: Array<{
    tokenAddress: string;
    alertTimestamp: Date;
    chain?: string;
  }>,
  batchSize: number = 10
): Promise<Map<number, number>> {
  const priceMap = new Map<number, number>(); // Map call index -> price

  for (let i = 0; i < calls.length; i += batchSize) {
    const batch = calls.slice(i, i + batchSize);

    const results = await Promise.allSettled(
      batch.map(async (call, batchIndex) => {
        const callIndex = i + batchIndex; // Global call index

        // Fetch price at exact alert timestamp from Birdeye API
        // Chain is auto-detected from address format if not provided
        const price = await fetchHistoricalPriceAtTime(
          call.tokenAddress,
          call.alertTimestamp,
          call.chain
        );

        if (price !== null && price > 0 && Number.isFinite(price)) {
          return { callIndex, price };
        }

        return null;
      })
    );

    // Process results - map by call index
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value && result.value.price !== undefined) {
        priceMap.set(result.value.callIndex, result.value.price);
      }
    }

    // Small delay between batches to avoid rate limiting
    if (i + batchSize < calls.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return priceMap;
}
