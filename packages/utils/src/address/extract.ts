/**
 * Consolidated Address Extraction
 * ===============================
 *
 * Single source of truth for extracting Solana and EVM addresses from text.
 * This module consolidates all address extraction logic to eliminate duplication.
 *
 * CRITICAL: Preserves full address and exact case as per project rules.
 *
 * @module @quantbot/utils/address
 */

import { extractCandidates, type AddressCandidate } from './extract-candidates.js';

/**
 * Result of address extraction
 */
export interface ExtractResult {
  solana: string[];
  evm: string[];
}

/**
 * Extract Solana and EVM addresses from text
 *
 * Returns deduplicated addresses preserving first-seen order.
 * All addresses are normalized (trimmed, punctuation removed) but case is preserved.
 *
 * @param text - Text to extract addresses from
 * @returns Object with solana and evm address arrays
 *
 * @example
 * ```typescript
 * const result = extractAddresses("Check out So11111111111111111111111111111111111111112 and 0x742d35cc6634c0532925a3b844bc9e7595f0beb0");
 * // result.solana = ["So11111111111111111111111111111111111111112"]
 * // result.evm = ["0x742d35cc6634c0532925a3b844bc9e7595f0beb0"]
 * ```
 */
export function extractAddresses(text: string): ExtractResult {
  if (!text) {
    return { solana: [], evm: [] };
  }

  const candidates = extractCandidates(text);

  // Filter to only Pass 1 accepted candidates (no rejection reason)
  const validCandidates = candidates.filter((c) => !c.reason);

  // Separate by type and extract normalized addresses
  const solana = new Set<string>();
  const evm = new Set<string>();

  for (const candidate of validCandidates) {
    if (candidate.addressType === 'solana') {
      solana.add(candidate.normalized);
    } else if (candidate.addressType === 'evm') {
      evm.add(candidate.normalized);
    }
  }

  return {
    solana: Array.from(solana),
    evm: Array.from(evm),
  };
}

/**
 * Extract only Solana addresses from text
 *
 * @param text - Text to extract Solana addresses from
 * @returns Array of Solana addresses (case-preserved, normalized)
 */
export function extractSolanaAddresses(text: string): string[] {
  return extractAddresses(text).solana;
}

/**
 * Extract only EVM addresses from text
 *
 * @param text - Text to extract EVM addresses from
 * @returns Array of EVM addresses (case-preserved, normalized)
 */
export function extractEvmAddresses(text: string): string[] {
  return extractAddresses(text).evm;
}

/**
 * Address extraction patterns (for reference and Python sharing)
 *
 * These patterns are used by both TypeScript and Python code.
 * Python scripts should use these exact patterns for consistency.
 */
export const ADDRESS_PATTERNS = {
  /**
   * Solana address pattern: base58, 32-44 characters
   * Base58 excludes: 0, O, I, l
   */
  SOLANA: /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g,

  /**
   * EVM address pattern: 0x followed by exactly 40 hex characters
   */
  EVM: /\b0x[a-fA-F0-9]{40}\b/g,

  /**
   * Zero address (rejected)
   */
  ZERO_ADDRESS: '0x0000000000000000000000000000000000000000',
} as const;

/**
 * Get address pattern strings for Python/other languages
 *
 * Returns the regex pattern strings that can be used in Python or other languages
 * to maintain consistency with TypeScript extraction.
 *
 * @returns Object with pattern strings
 */
export function getAddressPatternStrings(): {
  solana: string;
  evm: string;
  zeroAddress: string;
} {
  return {
    solana: '[1-9A-HJ-NP-Za-km-z]{32,44}',
    evm: '0x[a-fA-F0-9]{40}',
    zeroAddress: ADDRESS_PATTERNS.ZERO_ADDRESS,
  };
}
