/**
 * Multi-Chain Metadata Service
 * =============================
 *
 * Fetches token metadata across multiple chains (Solana, Ethereum, Base, BSC).
 * Uses Birdeye API with fallback logic for EVM chains.
 *
 * Key insight: EVM addresses are identical across ETH/Base/BSC.
 * We must try all three chains to determine which one actually has the token.
 */

import { logger, retryWithBackoff, isEvmAddress, isSolanaAddress } from '@quantbot/utils';
import type { Chain } from '@quantbot/core';
import { getBirdeyeClient } from './birdeye-client.js';
import { getMetadataCache } from './multi-chain-metadata-cache.js';

export interface TokenMetadata {
  address: string;
  chain: Chain;
  name?: string;
  symbol?: string;
  found: boolean;
}

export interface MultiChainMetadataResult {
  address: string;
  addressKind: 'solana' | 'evm';
  chainHint?: Chain;
  metadata: TokenMetadata[];
  primaryMetadata?: TokenMetadata; // The first successful result
}

/**
 * Fetch metadata for an address across all relevant chains
 *
 * For Solana addresses: only query Solana
 * For EVM addresses: query ETH, Base, and BSC in parallel (cheap calls)
 *
 * @param address - The token address (full, case-preserved)
 * @param chainHint - Optional hint from context (e.g., from Telegram message)
 * @returns Multi-chain metadata result with all attempted chains
 */
export async function fetchMultiChainMetadata(
  address: string,
  chainHint?: Chain
): Promise<MultiChainMetadataResult> {
  const birdeyeClient = getBirdeyeClient();
  const cache = getMetadataCache();

  // Determine address kind
  const addressKind = isEvmAddress(address) ? 'evm' : isSolanaAddress(address) ? 'solana' : 'evm';

  const result: MultiChainMetadataResult = {
    address,
    addressKind,
    chainHint,
    metadata: [],
  };

  if (addressKind === 'solana') {
    // Solana address: only query Solana chain
    // Check cache first
    const cached = cache.get(address, 'solana');
    if (cached) {
      logger.debug('Using cached Solana metadata', {
        address: address.substring(0, 20),
        cacheHit: true,
      });
      result.metadata.push(cached);
      if (cached.found) {
        result.primaryMetadata = cached;
      }
      return result;
    }

    logger.debug('Fetching Solana metadata', {
      address: address.substring(0, 20),
    });

    try {
      const metadata = await retryWithBackoff(
        () => birdeyeClient.getTokenMetadata(address, 'solana'),
        3, // maxRetries
        1000, // initialDelayMs (1 second)
        { address: address.substring(0, 20), chain: 'solana' }
      );

      const tokenMetadata: TokenMetadata = {
        address,
        chain: 'solana',
        name: metadata?.name,
        symbol: metadata?.symbol,
        found: metadata !== null,
      };

      result.metadata.push(tokenMetadata);

      // Cache the result (even if not found, to avoid repeated API calls)
      cache.set(address, 'solana', tokenMetadata);

      if (metadata) {
        result.primaryMetadata = tokenMetadata;
      }
    } catch (error) {
      logger.warn('Failed to fetch Solana metadata', {
        error: error instanceof Error ? error.message : String(error),
        address: address.substring(0, 20),
      });

      const tokenMetadata: TokenMetadata = {
        address,
        chain: 'solana',
        found: false,
      };
      result.metadata.push(tokenMetadata);
      // Cache negative result with shorter TTL (5 minutes)
      cache.set(address, 'solana', tokenMetadata, 1000 * 60 * 5);
    }
  } else {
    // EVM address: try all three chains (ETH, Base, BSC)
    // Use chainHint to prioritize if available
    const chains: Chain[] = chainHint
      ? [chainHint, ...(['ethereum', 'base', 'bsc'] as Chain[]).filter((c) => c !== chainHint)]
      : ['ethereum', 'base', 'bsc'];

    // Check cache for any chain first
    const cachedAny = cache.getAnyChain(address, chains);
    if (cachedAny) {
      logger.debug('Using cached EVM metadata', {
        address: address.substring(0, 20),
        chain: cachedAny.chain,
        cacheHit: true,
      });
      result.metadata.push(cachedAny.metadata);
      result.primaryMetadata = cachedAny.metadata;
      return result;
    }

    logger.debug('Fetching EVM metadata across chains', {
      address: address.substring(0, 20),
      chains,
      chainHint,
    });

    // Check cache for each chain first
    const cachedResults: Array<{ chain: Chain; metadata: TokenMetadata }> = [];
    const chainsToFetch: Chain[] = [];

    for (const chain of chains) {
      const cached = cache.get(address, chain);
      if (cached) {
        cachedResults.push({ chain, metadata: cached });
        result.metadata.push(cached);
        if (cached.found && !result.primaryMetadata) {
          result.primaryMetadata = cached;
        }
      } else {
        chainsToFetch.push(chain);
      }
    }

    // If we found metadata in cache, return early (unless we need to fetch more)
    if (result.primaryMetadata && chainsToFetch.length === 0) {
      return result;
    }

    // Query all remaining chains in parallel
    if (chainsToFetch.length > 0) {
      const startTime = Date.now();
      const parallelQueries = chainsToFetch.map(async (chain) => {
        const chainStartTime = Date.now();
        try {
          const metadata = await retryWithBackoff(
            () => birdeyeClient.getTokenMetadata(address, chain),
            3, // maxRetries
            1000, // initialDelayMs (1 second)
            { address: address.substring(0, 20), chain }
          );

          const tokenMetadata: TokenMetadata = {
            address,
            chain,
            name: metadata?.name,
            symbol: metadata?.symbol,
            found: metadata !== null,
          };

          // Cache the result
          cache.set(address, chain, tokenMetadata);

          const chainDuration = Date.now() - chainStartTime;
          logger.debug('Metadata API call completed', {
            address: address.substring(0, 20),
            chain,
            found: !!metadata,
            fromCache: false,
            durationMs: chainDuration,
          });

          return { chain, tokenMetadata, error: null };
        } catch (error) {
          logger.warn('Failed to fetch EVM metadata', {
            error: error instanceof Error ? error.message : String(error),
            address: address.substring(0, 20),
            chain,
          });

          const tokenMetadata: TokenMetadata = {
            address,
            chain,
            found: false,
          };
          // Cache negative result with shorter TTL (5 minutes)
          cache.set(address, chain, tokenMetadata, 1000 * 60 * 5);

          return {
            chain,
            tokenMetadata,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });

      const queryResults = await Promise.all(parallelQueries);
      const endTime = Date.now();
      const totalDuration = endTime - startTime;

      // Track metrics
      const foundCount = queryResults.filter((r) => r.tokenMetadata.found).length;
      const cacheHitCount = cachedResults.length;
      const hintCorrect = chainHint && result.primaryMetadata?.chain === chainHint;

      logger.debug('Parallel EVM queries completed', {
        address: address.substring(0, 20),
        durationMs: totalDuration,
        chainsQueried: chainsToFetch.length,
        chainsFound: foundCount,
        cacheHits: cacheHitCount,
        chainHint,
        hintCorrect,
        actualChain: result.primaryMetadata?.chain,
      });

      // Process results in priority order (chainHint first)
      for (const chain of chains) {
        const queryResult = queryResults.find((r) => r.chain === chain);
        if (queryResult) {
          result.metadata.push(queryResult.tokenMetadata);

          // Set primary metadata to first successful result (respecting priority order)
          if (queryResult.tokenMetadata.found && !result.primaryMetadata) {
            result.primaryMetadata = queryResult.tokenMetadata;
            logger.info('Found token metadata', {
              address: address.substring(0, 20),
              chain: queryResult.tokenMetadata.chain,
              symbol: queryResult.tokenMetadata.symbol,
              name: queryResult.tokenMetadata.name,
            });
          }
        }
      }
    }
  }

  return result;
}

/**
 * Batch fetch metadata for multiple addresses
 *
 * Useful for processing Telegram messages with multiple addresses.
 * Processes addresses in parallel batches to improve performance while respecting rate limits.
 *
 * @param addresses - Array of addresses to fetch
 * @param chainHint - Optional chain hint for all addresses
 * @param batchSize - Number of addresses to process in parallel (default: 5)
 * @returns Array of metadata results
 */
export async function batchFetchMultiChainMetadata(
  addresses: string[],
  chainHint?: Chain,
  batchSize: number = 5
): Promise<MultiChainMetadataResult[]> {
  const results: MultiChainMetadataResult[] = [];

  // Process in batches
  for (let i = 0; i < addresses.length; i += batchSize) {
    const batch = addresses.slice(i, i + batchSize);

    // Process batch in parallel
    const batchResults = await Promise.all(
      batch.map(async (address) => {
        try {
          return await fetchMultiChainMetadata(address, chainHint);
        } catch (error) {
          logger.error('Failed to fetch metadata for address', error as Error, {
            address: address.substring(0, 20),
          });

          // Add failed result
          const addressKind: 'solana' | 'evm' = isEvmAddress(address) ? 'evm' : 'solana';
          return {
            address,
            addressKind,
            chainHint,
            metadata: [],
          };
        }
      })
    );

    results.push(...batchResults);

    // Small delay between batches to respect rate limits
    if (i + batchSize < addresses.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return results;
}
