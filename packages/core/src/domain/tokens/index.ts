/**
 * Token Domain Types
 */

import { DateTime } from 'luxon';
import type { Chain } from '../../index.js';

/**
 * Token address (Solana mint address)
 *
 * CRITICAL: Always preserve full address (32-44 chars) and exact case.
 * Never truncate or modify mint addresses for storage or API calls.
 *
 * This is a branded type to prevent accidental mixing with other strings.
 * Use `createTokenAddress()` to create validated instances.
 */
export type TokenAddress = string & { readonly __brand: 'TokenAddress' };

/**
 * Creates a validated TokenAddress from a string.
 *
 * @param address - The mint address string to validate
 * @returns A branded TokenAddress type
 * @throws Error if address length is invalid (must be 32-44 characters)
 *
 * @example
 * ```typescript
 * const mint = createTokenAddress('So11111111111111111111111111111111111111112');
 * ```
 */
export function createTokenAddress(address: string): TokenAddress {
  if (address.length < 32 || address.length > 44) {
    // Note: @quantbot/core has zero dependencies, so we use plain Error
    // ValidationError would require @quantbot/utils dependency
    throw new Error(
      `ValidationError: Invalid mint address length: ${address.length}. Must be between 32 and 44 characters.`
    );
  }
  return address as TokenAddress;
}

/**
 * Token entity
 */
export interface Token {
  id: number;
  chain: Chain;
  address: TokenAddress; // Full mint address, case-preserved
  symbol?: string;
  name?: string;
  decimals?: number;
  metadata?: Record<string, unknown>;
  createdAt: DateTime;
  updatedAt: DateTime;
}

/**
 * Token metadata from APIs
 */
export interface TokenMetadata {
  name: string;
  symbol: string;
  decimals?: number;
  price?: number;
  logoURI?: string;
  priceChange24h?: number;
  volume24h?: number;
  marketCap?: number;
  address?: string;
}

