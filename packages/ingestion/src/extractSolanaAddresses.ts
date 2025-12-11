/**
 * Extract Solana addresses from text
 * 
 * CRITICAL: Returns full addresses with exact case preserved.
 * Never truncate or modify addresses - they must be used as-is for API calls.
 */

/**
 * Extract Solana addresses from text
 * 
 * Uses Base58 regex to find potential addresses, then filters for valid Solana length (32-44 chars).
 * Returns full addresses with exact case preserved.
 * 
 * @param text - Text to search for addresses
 * @returns Array of full Solana addresses (case-preserved)
 */
export function extractSolanaAddresses(text: string): string[] {
  // Base58 character set: 1-9, A-H, J-N, P-Z, a-k, m-z (no 0, O, I, l)
  // Solana addresses are 32-44 characters
  const base58Pattern = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

  const matches = text.match(base58Pattern) || [];
  const addresses = new Set<string>();

  for (const match of matches) {
    // Filter for valid Solana address length
    // Most Solana addresses are 32-44 characters
    if (match.length >= 32 && match.length <= 44) {
      // Preserve exact case - never modify the address
      addresses.add(match);
    }
  }

  return Array.from(addresses);
}

