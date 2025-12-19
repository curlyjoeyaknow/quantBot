/**
 * Extract Solana addresses from text
 *
 * Extracts base58-encoded Solana addresses (32-44 characters) from text.
 * Preserves exact case as per project rules.
 *
 * CRITICAL: Validates addresses using Solana's PublicKey to ensure they are
 * actually valid Solana addresses, not just random text matching the pattern.
 */
/**
 * Extract Solana addresses from text
 * @param text Text to search for Solana addresses
 * @returns Array of Solana addresses (case-preserved, validated)
 */
export declare function extractSolanaAddresses(text: string): string[];
//# sourceMappingURL=extractSolanaAddresses.d.ts.map
