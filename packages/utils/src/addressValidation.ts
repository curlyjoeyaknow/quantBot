/**
 * Address validation utilities
 * ============================
 *
 * Important: EVM addresses are identical across Ethereum, Base, and BSC.
 * You can validate "EVM-ness" but you cannot infer chain from the address alone.
 *
 * Solana: base58, typically 32–44 chars (public keys), no 0/O/I/l in base58 alphabet.
 */

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

// quick base58 check (format-level; does NOT verify checksum or curve)
export function isBase58(s: string): boolean {
  if (!s) return false;
  for (const ch of s) {
    if (!BASE58_ALPHABET.includes(ch)) return false;
  }
  return true;
}

export function isSolanaAddress(s: string): boolean {
  // Typical Solana pubkey length 32–44 chars in base58
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (t.length < 32 || t.length > 44) return false;
  return isBase58(t);
}

export function isEvmAddress(s: string): boolean {
  // Accepts lowercase/uppercase mixed, no checksum validation here.
  // Valid: 0x + 40 hex chars
  if (typeof s !== 'string') return false;
  const t = s.trim();
  return /^0x[a-fA-F0-9]{40}$/.test(t);
}

