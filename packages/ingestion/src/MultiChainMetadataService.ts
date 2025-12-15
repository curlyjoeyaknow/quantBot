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

import { logger } from '@quantbot/utils';
import type { Chain } from './types.js';
import { getBirdeyeClient } from '@quantbot/api-clients';
import { isEvmAddress, isSolanaAddress } from './addressValidation.js';

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
    logger.debug('Fetching Solana metadata', {
      address: address.substring(0, 20),
    });

    try {
      const metadata = await birdeyeClient.getTokenMetadata(address, 'solana');

      result.metadata.push({
        address,
        chain: 'solana',
        name: metadata?.name,
        symbol: metadata?.symbol,
        found: metadata !== null,
      });

      if (metadata) {
        result.primaryMetadata = result.metadata[0];
      }
    } catch (error) {
      logger.warn('Failed to fetch Solana metadata', error as Error, {
        address: address.substring(0, 20),
      });

      result.metadata.push({
        address,
        chain: 'solana',
        found: false,
      });
    }
  } else {
    // EVM address: try all three chains (ETH, Base, BSC)
    // Use chainHint to prioritize if available
    const chains: Chain[] = chainHint
      ? [chainHint, ...(['ethereum', 'base', 'bsc'] as Chain[]).filter((c) => c !== chainHint)]
      : ['ethereum', 'base', 'bsc'];

    logger.debug('Fetching EVM metadata across chains', {
      address: address.substring(0, 20),
      chains,
      chainHint,
    });

    // Try chains in order (prioritize chainHint)
    for (const chain of chains) {
      try {
        const metadata = await birdeyeClient.getTokenMetadata(address, chain);

        result.metadata.push({
          address,
          chain,
          name: metadata?.name,
          symbol: metadata?.symbol,
          found: metadata !== null,
        });

        // Set primary metadata to first successful result
        if (metadata && !result.primaryMetadata) {
          result.primaryMetadata = result.metadata[result.metadata.length - 1];
          logger.info('Found token metadata', {
            address: address.substring(0, 20),
            chain,
            symbol: metadata.symbol,
            name: metadata.name,
          });
        }
      } catch (error) {
        logger.warn('Failed to fetch EVM metadata', error as Error, {
          address: address.substring(0, 20),
          chain,
        });

        result.metadata.push({
          address,
          chain,
          found: false,
        });
      }
    }
  }

  return result;
}

/**
 * Batch fetch metadata for multiple addresses
 *
 * Useful for processing Telegram messages with multiple addresses.
 * Executes requests sequentially to avoid rate limiting.
 *
 * @param addresses - Array of addresses to fetch
 * @param chainHint - Optional chain hint for all addresses
 * @returns Array of metadata results
 */
export async function batchFetchMultiChainMetadata(
  addresses: string[],
  chainHint?: Chain
): Promise<MultiChainMetadataResult[]> {
  const results: MultiChainMetadataResult[] = [];

  for (const address of addresses) {
    try {
      const result = await fetchMultiChainMetadata(address, chainHint);
      results.push(result);

      // Small delay to avoid rate limiting (100ms between requests)
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      logger.error('Failed to fetch metadata for address', error as Error, {
        address: address.substring(0, 20),
      });

      // Add failed result
      results.push({
        address,
        addressKind: isEvmAddress(address) ? 'evm' : 'solana',
        chainHint,
        metadata: [],
      });
    }
  }

  return results;
}
