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
import type { Chain } from './types';
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
  primaryMetadata?: TokenMetadata;
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
export declare function fetchMultiChainMetadata(
  address: string,
  chainHint?: Chain
): Promise<MultiChainMetadataResult>;
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
export declare function batchFetchMultiChainMetadata(
  addresses: string[],
  chainHint?: Chain,
  batchSize?: number
): Promise<MultiChainMetadataResult[]>;
//# sourceMappingURL=MultiChainMetadataService.d.ts.map
