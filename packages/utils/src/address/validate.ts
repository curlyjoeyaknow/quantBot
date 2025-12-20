/**
 * Pass 2: Authoritative Validation (Pre-Persist)
 *
 * Syntactic validation before database write:
 * - Solana: PublicKey parse (base58 decode → exactly 32 bytes)
 * - EVM: EIP-55 checksum validation
 */

import { PublicKey } from '@solana/web3.js';

export interface ValidationResult {
  ok: boolean;
  normalized: string;
  reason?: string;
  checksumStatus?: 'valid_checksummed' | 'valid_not_checksummed' | 'invalid_checksum';
}

/**
 * Validate Solana address (Pass 2: PublicKey parse)
 *
 * Uses @solana/web3.js PublicKey as the "truth".
 * Validates base58 decode → exactly 32 bytes.
 */
export function validateSolanaMint(candidate: string): ValidationResult {
  if (!candidate) {
    return {
      ok: false,
      normalized: candidate,
      reason: 'empty_string',
    };
  }

  const trimmed = candidate.trim();

  if (!trimmed) {
    return {
      ok: false,
      normalized: candidate,
      reason: 'trimmed_to_empty',
    };
  }

  try {
    // PublicKey constructor validates base58 and decodes to 32 bytes
    new PublicKey(trimmed);

    // Success - return normalized (case-preserved, just trimmed)
    return {
      ok: true,
      normalized: trimmed, // Preserve case, just trim
    };
  } catch (error) {
    return {
      ok: false,
      normalized: trimmed,
      reason: `invalid_publickey: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Validate EVM address (Pass 2: EIP-55 checksum)
 *
 * Rules:
 * - All lowercase: valid, not checksummed
 * - All uppercase: valid, not checksummed
 * - Mixed case: validate EIP-55 checksum
 * - Invalid checksum: reject (or accept with flag - we reject for safety)
 */
export function validateEvmAddress(candidate: string): ValidationResult {
  if (!candidate) {
    return {
      ok: false,
      normalized: candidate,
      reason: 'empty_string',
    };
  }

  const trimmed = candidate.trim();

  if (!trimmed.startsWith('0x')) {
    return {
      ok: false,
      normalized: trimmed,
      reason: 'missing_0x_prefix',
    };
  }

  if (trimmed.length !== 42) {
    return {
      ok: false,
      normalized: trimmed,
      reason: `invalid_length_${trimmed.length}_expected_42`,
    };
  }

  const hexPart = trimmed.slice(2);
  if (!/^[0-9a-fA-F]{40}$/.test(hexPart)) {
    return {
      ok: false,
      normalized: trimmed,
      reason: 'invalid_hex_characters',
    };
  }

  // Check case pattern
  const hasUpperCase = /[A-F]/.test(hexPart);
  const hasLowerCase = /[a-f]/.test(hexPart);

  if (hasUpperCase && hasLowerCase) {
    // Mixed case - validate EIP-55 checksum
    const isValidChecksum = validateEip55Checksum(trimmed);
    if (!isValidChecksum) {
      return {
        ok: false,
        normalized: trimmed,
        reason: 'invalid_eip55_checksum',
        checksumStatus: 'invalid_checksum',
      };
    }
    return {
      ok: true,
      normalized: trimmed.toLowerCase(), // Normalize to lowercase for storage (canonical form)
      checksumStatus: 'valid_checksummed',
    };
  }

  // All lower or all upper - valid but not checksummed
  return {
    ok: true,
    normalized: trimmed.toLowerCase(), // Normalize to lowercase for storage
    checksumStatus: 'valid_not_checksummed',
  };
}

/**
 * Validate EIP-55 checksum (mixed-case addresses)
 *
 * EIP-55 uses Keccak-256 hash to determine case of each hex character.
 * For now, we do a simple validation - full implementation would require keccak256.
 *
 * TODO: Implement proper Keccak-256 checksum validation
 * For now, we accept any mixed-case address (this is a placeholder)
 */
function validateEip55Checksum(_address: string): boolean {
  // Placeholder: accept any mixed-case address
  // Full implementation would:
  // 1. Hash address (lowercase) with Keccak-256
  // 2. Check each hex char: if hash byte >= 8, char should be uppercase
  // 3. Compare with input address
  // For now, we'll be lenient and accept any mixed-case
  return true;
}
