/**
 * Address validation & extraction
 * ===============================
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

/**
 * Extract potential addresses from text (Telegram chat blobs).
 * Returns de-duplicated addresses preserving first-seen order.
 */
export function extractAddresses(text: string): {
  solana: string[];
  evm: string[];
} {
  const solCandidates = new Set<string>();
  const evmCandidates = new Set<string>();

  // EVM: 0x + 40 hex (exactly 42 chars total)
  // Use word boundaries to avoid matching partial addresses
  const evmMatches = text.match(/\b0x[a-fA-F0-9]{40}\b/g) ?? [];
  for (const m of evmMatches) evmCandidates.add(m);

  // Solana: greedy base58-ish tokens 32–44 chars; filter with base58 alphabet
  // Use word boundaries-ish: split on whitespace/punct, then validate.
  // Include Unicode box-drawing characters (├└│─) that bots use for formatting
  const tokens = text.split(/[\s"'`<>()[\]{}.,;:!?|\\\/\n\r\t├└│─]+/g);
  for (const tok of tokens) {
    if (isSolanaAddress(tok)) solCandidates.add(tok);
  }

  return {
    solana: [...solCandidates],
    evm: [...evmCandidates],
  };
}
