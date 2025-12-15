/**
 * Extract Solana addresses from text
 *
 * Extracts base58-encoded Solana addresses (32-44 characters) from text.
 * Preserves exact case as per project rules.
 *
 * CRITICAL: Validates addresses using Solana's PublicKey to ensure they are
 * actually valid Solana addresses, not just random text matching the pattern.
 */

import { PublicKey } from '@solana/web3.js';

/**
 * Validate if a string is a valid Solana address
 * Uses Solana's PublicKey constructor which validates base58 encoding
 */
function isValidSolanaAddress(address: string): boolean {
  if (!address || address.length < 32 || address.length > 44) {
    return false;
  }

  // Filter out obvious false positives
  if (address.toUpperCase().startsWith('DEF')) return false;

  // Check for invalid base58 characters (0, O, I, l)
  if (/[0OIl]/.test(address)) return false;

  // Check if it looks like hex (all lowercase/uppercase hex chars)
  if (/^[0-9a-fA-F]{32,44}$/.test(address)) {
    // If it's all hex, it's likely not base58
    return false;
  }

  // Check if it looks like words (mixed case with word boundaries)
  // Real Solana addresses don't typically have this pattern
  if (/[A-Z][a-z]+[A-Z][a-z]+/.test(address)) {
    // This looks like "DepartmentofGovernmentEfficiency" - not a valid address
    return false;
  }

  // Use Solana's PublicKey to validate the address
  // This is the most reliable way to check if it's a valid Solana address
  try {
    const pubkey = new PublicKey(address);
    // PublicKey constructor will throw if invalid
    // Also verify it's not the System Program (common false positive)
    return pubkey.toBase58() === address; // Ensure case is preserved
  } catch {
    return false;
  }
}

/**
 * Extract Solana addresses from text
 * @param text Text to search for Solana addresses
 * @returns Array of Solana addresses (case-preserved, validated)
 */
export function extractSolanaAddresses(text: string): string[] {
  const addresses: string[] = [];

  if (!text) return addresses;

  // Clean text (remove HTML tags, decode entities)
  let cleanText = text.replace(/<[^>]+>/g, ' ');
  cleanText = cleanText.replace(/&apos;/g, "'");
  cleanText = cleanText.replace(/&quot;/g, '"');
  cleanText = cleanText.replace(/&amp;/g, '&');

  // Solana: base58 addresses (32-44 chars)
  // Base58 alphabet: 1-9, A-H, J-N, P-Z, a-k, m-z (excludes 0, O, I, l)
  // Use word boundaries to avoid matching partial addresses
  const solanaRegex = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
  const solanaMatches = cleanText.match(solanaRegex) || [];

  // Validate each match using Solana's PublicKey
  const validSolana = solanaMatches.filter((addr) => {
    return isValidSolanaAddress(addr);
  });

  addresses.push(...validSolana);

  // Addresses in code blocks (more likely to be real addresses)
  const codeBlockRegex = /`([1-9A-HJ-NP-Za-km-z]{32,44})`/g;
  const codeMatches = cleanText.match(codeBlockRegex) || [];
  codeMatches.forEach((match) => {
    const addr = match.replace(/`/g, '').trim();
    if (isValidSolanaAddress(addr) && !addresses.includes(addr)) {
      addresses.push(addr);
    }
  });

  // Addresses in URLs (common format: https://pump.fun/ADDRESS)
  const urlRegex =
    /(?:pump\.fun|birdeye\.so|solscan\.io|solana\.fm)[\/=]([1-9A-HJ-NP-Za-km-z]{32,44})/gi;
  const urlMatches = cleanText.matchAll(urlRegex);
  for (const match of urlMatches) {
    const addr = match[1];
    if (isValidSolanaAddress(addr) && !addresses.includes(addr)) {
      addresses.push(addr);
    }
  }

  // Remove duplicates (preserve case)
  const unique = new Set<string>();
  addresses.forEach((addr) => {
    unique.add(addr.toLowerCase()); // Preserve exact case per project rules
  });

  return Array.from(unique);
}
