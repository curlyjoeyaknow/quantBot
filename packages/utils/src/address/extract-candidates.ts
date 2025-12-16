/**
 * Pass 1: Address Extraction (Fast, Deterministic, No Network)
 *
 * Extracts potential addresses from text with normalization.
 * This is the "cheap filter" that runs at extraction time.
 */

export interface AddressCandidate {
  raw: string; // Original string from text
  normalized: string; // Normalized (trimmed, punctuation removed)
  addressType: 'solana' | 'evm';
  reason?: string; // Rejection reason if invalid
}

const BASE58_CHARS = new Set('123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz');
const BASE58_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
const EVM_ADDRESS_RE = /\b0x[a-fA-F0-9]{40}\b/g;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Normalize address candidate (trim, remove surrounding punctuation).
 * Preserves case - DO NOT change case.
 */
export function normalizeCandidate(raw: string): string {
  if (!raw) return '';
  // Trim whitespace
  let normalized = raw.trim();
  // Remove common surrounding punctuation: , ) ] . ( [ etc.
  // Match one or more punctuation chars at start or end
  normalized = normalized.replace(/^[,)\].]+|[,(\[.]+$/g, '');
  // Also handle parentheses and brackets more explicitly (need to escape)
  normalized = normalized.replace(/^[\(\[\{]+|[\)\]\}]+$/g, '');
  // Final trim
  normalized = normalized.trim();
  // If still has parentheses/brackets, try again (handles nested cases)
  if (normalized.startsWith('(') || normalized.startsWith('[') || normalized.startsWith('{')) {
    normalized = normalized.replace(/^[\(\[\{]+|[\)\]\}]+$/g, '');
    normalized = normalized.trim();
  }
  return normalized;
}

/**
 * Extract Solana address candidates from text.
 * Pass 1 validation: length (32-44), base58 charset, no spaces.
 */
export function extractSolanaCandidates(text: string): AddressCandidate[] {
  if (!text) return [];

  const matches = text.matchAll(BASE58_RE);
  const seen = new Set<string>();
  const candidates: AddressCandidate[] = [];

  for (const match of matches) {
    const raw = match[0];
    // Deduplicate within same message (case-sensitive to preserve case)
    if (seen.has(raw)) continue;
    seen.add(raw);

    const normalized = normalizeCandidate(raw);

    // Pass 1 validation
    if (!normalized) {
      candidates.push({
        raw,
        normalized: raw,
        addressType: 'solana',
        reason: 'normalized_to_empty',
      });
      continue;
    }

    // Length check: Solana pubkeys are base58-encoded 32 bytes = 32-44 chars
    if (normalized.length < 32 || normalized.length > 44) {
      candidates.push({
        raw,
        normalized,
        addressType: 'solana',
        reason: `invalid_length_${normalized.length}`,
      });
      continue;
    }

    // Base58 character set check
    const invalidChars = Array.from(normalized).filter((c) => !BASE58_CHARS.has(c));
    if (invalidChars.length > 0) {
      candidates.push({
        raw,
        normalized,
        addressType: 'solana',
        reason: `invalid_chars_${invalidChars.slice(0, 10).join('')}`,
      });
      continue;
    }

    // No spaces
    if (normalized.includes(' ')) {
      candidates.push({
        raw,
        normalized,
        addressType: 'solana',
        reason: 'contains_spaces',
      });
      continue;
    }

    // Pass 1 accepted
    candidates.push({
      raw,
      normalized,
      addressType: 'solana',
    });
  }

  return candidates;
}

/**
 * Extract EVM address candidates from text.
 * Pass 1 validation: 0x prefix, 40 hex chars, not zero address.
 */
export function extractEvmCandidates(text: string): AddressCandidate[] {
  if (!text) return [];

  const matches = text.matchAll(EVM_ADDRESS_RE);
  const seen = new Set<string>();
  const candidates: AddressCandidate[] = [];

  for (const match of matches) {
    const raw = match[0];
    // Deduplicate within same message
    if (seen.has(raw)) continue;
    seen.add(raw);

    const normalized = normalizeCandidate(raw);

    // Reject zero address
    if (normalized.toLowerCase() === ZERO_ADDRESS) {
      candidates.push({
        raw,
        normalized,
        addressType: 'evm',
        reason: 'zero_address',
      });
      continue;
    }

    // Pass 1 accepted (format is already validated by regex)
    candidates.push({
      raw,
      normalized,
      addressType: 'evm',
    });
  }

  return candidates;
}

/**
 * Extract all address candidates (Solana + EVM) from text.
 * Returns deduplicated candidates with Pass 1 validation status.
 */
export function extractCandidates(text: string): AddressCandidate[] {
  const solana = extractSolanaCandidates(text);
  const evm = extractEvmCandidates(text);
  return [...solana, ...evm];
}
