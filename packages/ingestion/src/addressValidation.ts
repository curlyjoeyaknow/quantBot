/**
 * Address validation & extraction
 * ===============================
 *
 * DEPRECATED: Use @quantbot/utils address extraction instead.
 * This file is kept for backward compatibility but delegates to the consolidated extractor.
 *
 * Important: EVM addresses are identical across Ethereum, Base, and BSC.
 * You can validate "EVM-ness" but you cannot infer chain from the address alone.
 *
 * Solana: base58, typically 32–44 chars (public keys), no 0/O/I/l in base58 alphabet.
 *
 * Note: isEvmAddress and isSolanaAddress have been moved to @quantbot/utils
 * extractAddresses now delegates to @quantbot/utils consolidated extractor.
 */

import { isSolanaAddress, extractAddresses as extractAddressesFromUtils } from '@quantbot/utils';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

// quick base58 check (format-level; does NOT verify checksum or curve)
export function isBase58(s: string): boolean {
  if (!s) return false;
  for (const ch of s) {
    if (!BASE58_ALPHABET.includes(ch)) return false;
  }
  return true;
}

/**
 * Extract potential addresses from text (Telegram chat blobs).
 * Returns de-duplicated addresses preserving first-seen order.
 * 
 * @deprecated Use extractAddresses from @quantbot/utils instead
 */
export function extractAddresses(text: string): {
  solana: string[];
  evm: string[];
} {
  // Delegate to consolidated extractor
  return extractAddressesFromUtils(text);
}
