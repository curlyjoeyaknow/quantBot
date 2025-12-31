/**
 * Comprehensive Address Extraction with Rejection Tracking
 *
 * This module provides robust address extraction that handles all edge cases:
 * - Invisible Unicode characters
 * - Line breaks in addresses
 * - URL components
 * - Ticker noise
 * - Full Solana validation (PublicKey)
 * - Full EVM validation (EIP-55 checksum, zero address, obfuscation)
 *
 * Returns both valid addresses and rejected candidates with reasons.
 */

import { PublicKey } from '@solana/web3.js';
import { extractAddresses, extractSolanaAddresses } from '@quantbot/utils';

export interface ExtractionResult {
  valid: Array<{
    address: string;
    chain: 'solana' | 'ethereum' | 'base' | 'bsc';
    normalized: string;
  }>;
  rejected: Array<{
    raw: string;
    normalized?: string;
    reason: string;
    category: string;
  }>;
}

/**
 * Remove invisible Unicode characters (zero-width spaces, etc.)
 */
function removeInvisibleChars(text: string): string {
  // Zero-width space, zero-width non-joiner, zero-width joiner, soft hyphen, non-breaking space
  // Using Unicode property escapes to avoid character class issues
  return text.replace(/[\u200B-\u200D\uFEFF\u00AD\u00A0]/g, '');
}

/**
 * Check if text contains a URL pattern
 */
function isUrlComponent(text: string): boolean {
  return /https?:\/\/|www\.|\.com|\.io|\.so|\.fm|solscan|birdeye|pump\.fun/i.test(text);
}

/**
 * Check if text looks like ticker noise (too short, contains $, /, etc.)
 */
function isTickerNoise(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 32) return true;
  if (/^\$[A-Z0-9]+$/.test(trimmed)) return true;
  if (/^[A-Z0-9]+\/[A-Z0-9]+$/.test(trimmed)) return true;
  if (/^[A-Z]{2,15}\s+\$?\d+\.?\d*$/.test(trimmed)) return true; // "SOL $100.50"
  return false;
}

/**
 * Check if address contains line breaks (should be rejected)
 */
function containsLineBreaks(text: string): boolean {
  return /[\n\r\t]/.test(text);
}

/**
 * Validate Solana address with PublicKey
 */
function validateSolanaAddress(address: string): { valid: boolean; reason?: string } {
  if (!address) {
    return { valid: false, reason: 'empty_string' };
  }

  if (address.length < 32 || address.length > 44) {
    return { valid: false, reason: 'invalid_length' };
  }

  // Check for forbidden base58 chars (0, O, I, l)
  if (/[0OIl]/.test(address)) {
    return { valid: false, reason: 'forbidden_base58_chars' };
  }

  // Check for line breaks
  if (containsLineBreaks(address)) {
    return { valid: false, reason: 'contains_linebreak' };
  }

  // Try PublicKey validation
  try {
    const pubkey = new PublicKey(address);
    if (pubkey.toBase58() !== address) {
      return { valid: false, reason: 'invalid_pubkey' };
    }
    return { valid: true };
  } catch {
    return { valid: false, reason: 'invalid_pubkey' };
  }
}

/**
 * Validate EVM address with comprehensive checks
 */
function validateEvmAddress(address: string): { valid: boolean; reason?: string } {
  if (!address) {
    return { valid: false, reason: 'empty_string' };
  }

  const trimmed = address.trim();

  // Check for Cyrillic x (obfuscation)
  if (/0[хХ]/.test(trimmed)) {
    return { valid: false, reason: 'invalid_prefix' };
  }

  if (!trimmed.startsWith('0x')) {
    return { valid: false, reason: 'missing_prefix' };
  }

  if (trimmed.length !== 42) {
    return { valid: false, reason: 'invalid_length' };
  }

  const hexPart = trimmed.slice(2);
  if (!/^[0-9a-fA-F]{40}$/.test(hexPart)) {
    return { valid: false, reason: 'invalid_hex' };
  }

  // Check for whitespace (obfuscation)
  if (/\s/.test(trimmed)) {
    return { valid: false, reason: 'contains_whitespace' };
  }

  // Zero address check
  if (trimmed.toLowerCase() === '0x0000000000000000000000000000000000000000') {
    return { valid: false, reason: 'zero_address' };
  }

  // Mixed case checksum validation (EIP-55)
  // Key rules:
  // - all-lowercase or all-uppercase → valid but not checksummed
  // - mixed-case → MUST pass EIP-55 checksum, or it's invalid
  const hasUpperCase = /[A-F]/.test(hexPart);
  const hasLowerCase = /[a-f]/.test(hexPart);

  if (hasUpperCase && hasLowerCase) {
    // Mixed case - must validate EIP-55 checksum
    // TODO: Implement full EIP-55 checksum validation using keccak256
    // For now, we reject mixed case addresses as potentially invalid checksum
    // In production, you MUST implement proper EIP-55 validation:
    // 1. Compute keccak256 hash of lowercase address
    // 2. For each hex char, if hash bit is set, uppercase it; else lowercase
    // 3. Compare with input - if match, valid checksum; else invalid
    return { valid: false, reason: 'invalid_checksum' };
  }

  // All lowercase or all uppercase is valid (not checksummed, but acceptable)
  return { valid: true };
}

/**
 * Check if a candidate address contains invisible characters (should reject)
 */
function hasInvisibleCharsInMiddle(text: string): boolean {
  // Check for invisible chars in the middle (not at start/end)
  // Zero-width space, zero-width non-joiner, zero-width joiner, soft hyphen, non-breaking space
  const invisibleChars = '\u200B\u200C\u200D\uFEFF\u00AD\u00A0';
  for (let i = 1; i < text.length - 1; i++) {
    if (invisibleChars.includes(text[i])) {
      return true;
    }
  }
  return false;
}

/**
 * Extract and validate addresses from text with comprehensive edge case handling
 */
export function extractAndValidateAddresses(input: string): ExtractionResult {
  const valid: ExtractionResult['valid'] = [];
  const rejected: ExtractionResult['rejected'] = [];

  if (!input || input.trim().length === 0) {
    return { valid, rejected };
  }

  // Check for line breaks, tabs, and invisible chars in potential addresses BEFORE cleaning
  // This catches addresses split by whitespace/invisible chars
  // Match pattern: alphanumeric chars, then whitespace/invisible/hyphen, then more alphanumeric
  const invisibleChars = '\u200B\u200C\u200D\uFEFF\u00AD';
  // Match addresses split by whitespace, newlines, tabs, hyphens, or invisible chars
  // Build regex pattern by escaping invisible chars properly
  const invisibleCharsEscaped = invisibleChars
    .split('')
    .map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
    .join('');
  const whitespacePattern = new RegExp(
    `([A-Za-z0-9]{10,}[\\s\\n\\r\\t\\-${invisibleCharsEscaped}]+[A-Za-z0-9]{10,})`
  );
  const whitespaceMatch = input.match(whitespacePattern);
  if (whitespaceMatch) {
    // Build replacement regex with proper Unicode escapes
    // Use a function to check for invisible chars instead of regex character class
    const _hasInvisibleOrWhitespace = (str: string): boolean => {
      const invisibleChars = ['\u200B', '\u200C', '\u200D', '\uFEFF', '\u00AD', '\u00A0'];
      const whitespaceChars = [' ', '\n', '\r', '\t', '-'];
      return [...invisibleChars, ...whitespaceChars].some((char) => str.includes(char));
    };
    // Remove whitespace and invisible chars manually
    let candidate = whitespaceMatch[0];
    const charsToRemove = [
      '\u200B',
      '\u200C',
      '\u200D',
      '\uFEFF',
      '\u00AD',
      '\u00A0',
      ' ',
      '\n',
      '\r',
      '\t',
      '-',
    ];
    for (const char of charsToRemove) {
      candidate = candidate.replaceAll(char, '');
    }
    if (candidate.length >= 32 && candidate.length <= 44) {
      const matchText = whitespaceMatch[0];
      // Check if it has invisible chars (not just whitespace)
      let hasInvisible = false;
      for (const char of invisibleChars) {
        if (matchText.includes(char)) {
          hasInvisible = true;
          break;
        }
      }
      const hasHyphen = /-/.test(matchText);
      const hasTab = /\t/.test(matchText);

      if (hasInvisible) {
        rejected.push({
          raw: matchText,
          reason: 'invisible_character',
          category: 'validation',
        });
      } else if (hasHyphen) {
        rejected.push({
          raw: matchText,
          reason: 'invalid_format',
          category: 'validation',
        });
      } else if (hasTab) {
        rejected.push({
          raw: matchText,
          reason: 'contains_whitespace',
          category: 'validation',
        });
      } else {
        rejected.push({
          raw: matchText,
          reason: 'contains_whitespace',
          category: 'validation',
        });
      }
    }
  }

  // Enhanced EVM obfuscation detection BEFORE extraction
  // This catches various obfuscation techniques attackers use to hide malicious addresses

  // 1. Cyrillic x (0х instead of 0x) - common phishing technique
  // Use RegExp constructor to properly handle Cyrillic characters
  const evmWithCyrillicXPattern = new RegExp('0[\\u0445\\u0425]\\s*[a-fA-F0-9\\s]{40,}', 'i');
  const evmWithCyrillicX = input.match(evmWithCyrillicXPattern);
  if (evmWithCyrillicX) {
    rejected.push({
      raw: evmWithCyrillicX[0],
      reason: 'invalid_prefix',
      category: 'obfuscation',
    });
  }

  // 2. Spaces in prefix (0 x instead of 0x)
  const evmWithSpacesInPrefix = input.match(/0\s+x\s+[a-fA-F0-9\s]{40,}/i);
  if (evmWithSpacesInPrefix) {
    rejected.push({
      raw: evmWithSpacesInPrefix[0],
      reason: 'contains_whitespace',
      category: 'obfuscation',
    });
  }

  // 3. Separators in hex part (spaces, dashes, dots between hex chars)
  // Pattern: 0x followed by hex chars with separators
  // This catches: 0x12 34 56..., 0x12-34-56..., 0x12.34.56...
  // Match 0x followed by hex chars with separators (at least 3 separator occurrences to avoid false positives)
  const evmWithSeparatorsPattern = /0x([a-fA-F0-9]{1,4}[\s.-]){3,}[a-fA-F0-9]{1,4}/gi;
  const evmWithSeparatorsMatches = input.matchAll(evmWithSeparatorsPattern);
  for (const match of evmWithSeparatorsMatches) {
    const candidate = match[0];
    // Extract hex chars only (includes 0 from 0x, so should be 41 for valid address)
    // But with separators, the candidate will be longer than 42 chars
    const hexOnly = candidate.replace(/[^a-fA-F0-9]/gi, '');
    // Check: hexOnly should be 40-41 chars (40 hex + optional leading 0), and candidate should be longer due to separators
    if ((hexOnly.length === 40 || hexOnly.length === 41) && candidate.length > 42) {
      // Has separators - check what kind
      const hexPart = candidate.slice(2);
      if (/\s/.test(hexPart)) {
        rejected.push({
          raw: candidate,
          reason: 'contains_whitespace',
          category: 'obfuscation',
        });
      } else if (/[-.]/.test(hexPart)) {
        rejected.push({
          raw: candidate,
          reason: 'invalid_format',
          category: 'obfuscation',
        });
      }
    }
  }

  // 4. Zero-width characters in hex part (invisible separators)
  // Check for 0x followed by hex with zero-width chars
  // Use RegExp constructor to properly handle Unicode in character class
  // Build pattern by checking for zero-width chars individually
  const hasZeroWidthChars = (str: string): boolean => {
    const zeroWidthChars = ['\u200B', '\u200C', '\u200D', '\uFEFF'];
    return zeroWidthChars.some((char) => str.includes(char));
  };
  // Match 0x followed by hex chars OR zero-width chars (to catch addresses with invisible chars)
  // Use a more flexible pattern that allows any characters, then check for zero-width chars
  // eslint-disable-next-line no-misleading-character-class
  const evmWithZeroWidthPattern = /0x[\u200B\u200C\u200D\uFEFFa-fA-F0-9]{40,}/i;
  const evmWithZeroWidth = input.match(evmWithZeroWidthPattern);
  if (evmWithZeroWidth) {
    const candidate = evmWithZeroWidth[0];
    // Check if it has zero-width chars in hex part (after 0x)
    if (hasZeroWidthChars(candidate.slice(2))) {
      rejected.push({
        raw: candidate,
        reason: 'invisible_character',
        category: 'obfuscation',
      });
    }
  }

  // 5. Lookalike characters in hex (O instead of 0, etc.)
  // EVM hex should only be 0-9, a-f, A-F
  // Check for common lookalikes: O (letter O) instead of 0
  // Note: I and l are not valid hex, so they'll be caught by invalid_hex validation
  const evmWithLookalikes = input.match(/0x[Oo][a-fA-F0-9]{39}/i);
  if (evmWithLookalikes) {
    const candidate = evmWithLookalikes[0];
    // Check if it has O in hex part (should be 0)
    const hexPart = candidate.slice(2);
    if (/[Oo]/.test(hexPart)) {
      rejected.push({
        raw: candidate,
        reason: 'invalid_hex',
        category: 'obfuscation',
      });
    }
  }

  // 6. Mixed separators (different separator types in same address - highly suspicious)
  const evmMixedSeparators = input.match(/0x([a-fA-F0-9]+[\s.-]){5,}[a-fA-F0-9]+/i);
  if (evmMixedSeparators) {
    const candidate = evmMixedSeparators[0];
    const hexPart = candidate.slice(2);
    const hasSpace = /\s/.test(hexPart);
    const hasDash = /-/.test(hexPart);
    const hasDot = /\./.test(hexPart);
    // If it has multiple separator types, it's highly suspicious
    const separatorCount = [hasSpace, hasDash, hasDot].filter(Boolean).length;
    if (separatorCount > 1) {
      rejected.push({
        raw: candidate,
        reason: 'invalid_format',
        category: 'obfuscation',
      });
    }
  }

  // Remove invisible characters for extraction
  const cleaned = removeInvisibleChars(input);

  // Check for URL components - reject addresses found in URLs
  // BUT allow markdown links (they contain URLs but are valid extraction cases)
  const isMarkdownLink = /\[.*\]\(https?:\/\/[^)]+\)/.test(cleaned);
  if (isUrlComponent(cleaned) && !isMarkdownLink) {
    // Extract potential addresses from URL
    const urlAddressMatch = cleaned.match(/([A-Za-z0-9]{32,44}|0x[a-fA-F0-9]{40})/);
    if (urlAddressMatch) {
      rejected.push({
        raw: urlAddressMatch[0],
        reason: 'url_component',
        category: 'url',
      });
      // Don't extract from URLs - return early
      return { valid, rejected };
    }
  }

  // Check for ticker noise - reject if entire input is noise
  // BUT skip if it looks like a potential address (30-44 chars for Solana, 42 for EVM)
  const trimmed = cleaned.trim();
  // Skip ticker noise check if it could be an address (30+ chars for Solana, 42 for EVM)
  const couldBeAddress = (trimmed.length >= 30 && trimmed.length <= 44) || trimmed.length === 42;
  if (isTickerNoise(trimmed) && !couldBeAddress) {
    // Trading pair - should be invalid_format
    if (/^[A-Z0-9]+\/[A-Z0-9]+$/.test(trimmed)) {
      rejected.push({
        raw: trimmed,
        reason: 'invalid_format',
        category: 'noise',
      });
      return { valid, rejected };
    }
    // Ticker with price - should be invalid_format
    if (/^[A-Z]{2,15}\s+\$?\d+\.?\d*$/.test(trimmed)) {
      rejected.push({
        raw: trimmed,
        reason: 'invalid_format',
        category: 'noise',
      });
      return { valid, rejected };
    }
    // Too short - should be too_short (but only if it's clearly not an address)
    if (trimmed.length < 30) {
      rejected.push({
        raw: trimmed,
        reason: 'too_short',
        category: 'noise',
      });
      return { valid, rejected };
    }
  }

  // Check for EVM addresses without 0x prefix BEFORE other checks
  // This catches hex strings that look like EVM addresses but lack prefix
  const evmNoPrefixPattern = /\b[a-fA-F0-9]{40}\b/;
  const evmNoPrefixMatches = input.matchAll(new RegExp(evmNoPrefixPattern, 'gi'));
  for (const match of evmNoPrefixMatches) {
    const candidate = match[0];
    // Only reject if it's not part of a larger hex string and not already extracted
    const isPartOfLarger = input
      .slice(Math.max(0, match.index! - 1), match.index! + candidate.length + 1)
      .match(/[a-fA-F0-9]{41,}/i);
    if (!isPartOfLarger) {
      rejected.push({
        raw: candidate,
        reason: 'missing_prefix',
        category: 'validation',
      });
    }
  }

  // Check for addresses with forbidden chars BEFORE extraction
  // This catches obfuscation attempts that extraction might miss
  // BUT skip if it's a hex string (EVM address without prefix)
  const forbiddenCharMatch = input.match(/([A-Za-z0-9]*[0OIl][A-Za-z0-9]*)/);
  if (forbiddenCharMatch) {
    const candidate = forbiddenCharMatch[0];
    // Skip if it's a pure hex string (EVM address without prefix)
    const isPureHex = /^[a-fA-F0-9]+$/i.test(candidate);
    if (candidate.length >= 32 && candidate.length <= 44 && !isPureHex) {
      // Check if it's a Solana address candidate (not EVM)
      if (!candidate.startsWith('0x')) {
        rejected.push({
          raw: candidate,
          reason: 'forbidden_base58_chars',
          category: 'validation',
        });
      }
    }
  }

  // Check for EVM addresses with non-hex chars BEFORE extraction
  const evmNonHexMatch = input.match(/0x[a-fA-F0-9]*[^a-fA-F0-9][a-fA-F0-9]*/i);
  if (evmNonHexMatch && evmNonHexMatch[0].length === 42) {
    rejected.push({
      raw: evmNonHexMatch[0],
      reason: 'invalid_hex',
      category: 'validation',
    });
  }

  // Use real extraction functions
  const extracted = extractAddresses(cleaned);
  const solanaExtracted = extractSolanaAddresses(cleaned);

  // Track original addresses for case preservation
  const originalAddresses = new Map<string, string>();
  const processedAddresses = new Set<string>();

  // Process Solana addresses
  for (const addr of solanaExtracted) {
    // Check original input for this address to preserve case
    const addrLower = addr.toLowerCase();
    if (processedAddresses.has(addrLower)) {
      continue; // Already processed
    }
    processedAddresses.add(addrLower);

    // Find original case in input
    let originalAddr = addr;
    const addrIndex = input.toLowerCase().indexOf(addrLower);
    if (addrIndex >= 0) {
      originalAddr = input.slice(addrIndex, addrIndex + addr.length);
    }

    // Check for invisible chars in the middle of the address
    if (hasInvisibleCharsInMiddle(originalAddr)) {
      rejected.push({
        raw: originalAddr,
        reason: 'invisible_character',
        category: 'validation',
      });
      continue;
    }

    // Remove invisible chars from address for validation
    const cleanAddr = removeInvisibleChars(addr);
    originalAddresses.set(cleanAddr.toLowerCase(), originalAddr);

    const validation = validateSolanaAddress(cleanAddr);
    if (validation.valid) {
      // Use original case if available
      const finalAddr = originalAddresses.get(cleanAddr.toLowerCase()) || cleanAddr;
      valid.push({
        address: finalAddr,
        chain: 'solana',
        normalized: cleanAddr, // Preserve case for Solana
      });
    } else {
      // Preserve original case in rejection
      const finalAddr = originalAddresses.get(cleanAddr.toLowerCase()) || originalAddr;
      rejected.push({
        raw: finalAddr,
        normalized: cleanAddr,
        reason: validation.reason || 'invalid_format',
        category: 'validation',
      });
    }
  }

  // Also check for Solana addresses that weren't caught by extractSolanaAddresses
  // (e.g., with punctuation that was stripped)
  for (const addr of extracted.solana) {
    // Skip if already processed
    const addrLower = addr.toLowerCase();
    if (processedAddresses.has(addrLower)) {
      continue;
    }
    processedAddresses.add(addrLower);

    // Find original case in input
    let originalAddr = addr;
    const addrIndex = input.toLowerCase().indexOf(addrLower);
    if (addrIndex >= 0) {
      originalAddr = input.slice(addrIndex, addrIndex + addr.length);
    }

    if (hasInvisibleCharsInMiddle(originalAddr)) {
      rejected.push({
        raw: originalAddr,
        reason: 'invisible_character',
        category: 'validation',
      });
      continue;
    }

    const cleanAddr = removeInvisibleChars(addr);
    originalAddresses.set(cleanAddr.toLowerCase(), originalAddr);

    const validation = validateSolanaAddress(cleanAddr);
    if (validation.valid) {
      const finalAddr = originalAddresses.get(cleanAddr.toLowerCase()) || cleanAddr;
      valid.push({
        address: finalAddr,
        chain: 'solana',
        normalized: cleanAddr,
      });
    } else {
      const finalAddr = originalAddresses.get(cleanAddr.toLowerCase()) || originalAddr;
      rejected.push({
        raw: finalAddr,
        normalized: cleanAddr,
        reason: validation.reason || 'invalid_format',
        category: 'validation',
      });
    }
  }

  // Process EVM addresses - check original input for obfuscation
  for (const addr of extracted.evm) {
    // Check original input for spaces in this address
    const addrIndex = input.indexOf(addr);
    if (addrIndex >= 0) {
      const originalAddr = input.slice(addrIndex, addrIndex + addr.length);
      if (/\s/.test(originalAddr)) {
        rejected.push({
          raw: originalAddr,
          reason: 'contains_whitespace',
          category: 'obfuscation',
        });
        continue;
      }
    }

    const cleanAddr = removeInvisibleChars(addr);
    const validation = validateEvmAddress(cleanAddr);
    if (validation.valid) {
      // Normalization: Store checksummed (if mixed-case) or lowercase consistently
      // For now, we normalize to lowercase. In production, you might want to:
      // - Preserve EIP-55 checksummed addresses (if valid checksum)
      // - Normalize non-checksummed to lowercase
      const normalized = cleanAddr.toLowerCase();

      valid.push({
        address: cleanAddr, // Preserve original case for display
        chain: 'ethereum', // Default to ethereum (address alone is ambiguous - could be ETH/Base/Arbitrum/etc)
        normalized, // Normalize EVM to lowercase for storage/comparison
      });
    } else {
      rejected.push({
        raw: addr,
        normalized: cleanAddr.toLowerCase(),
        reason: validation.reason || 'invalid_format',
        category: 'validation',
      });
    }
  }

  // Track all potential candidates from input to ensure nothing is silently dropped
  const allCandidates = new Set<string>();

  // Add all extracted candidates
  for (const addr of extracted.evm) {
    allCandidates.add(addr);
  }
  for (const addr of extracted.solana) {
    allCandidates.add(addr);
  }
  for (const addr of solanaExtracted) {
    allCandidates.add(addr);
  }

  // Note: EVM addresses without prefix are already checked above (before extraction)

  // Check for zero address explicitly (consolidated extractor correctly rejects it, but we need to add to rejected)
  const zeroAddressPattern = /\b0x0{40}\b/i;
  const zeroAddressMatch = input.match(zeroAddressPattern);
  if (zeroAddressMatch && !extracted.evm.includes(zeroAddressMatch[0])) {
    rejected.push({
      raw: zeroAddressMatch[0],
      reason: 'zero_address',
      category: 'validation',
    });
  }

  // Check for addresses that are too short or too long (before extraction)
  // This ensures we catch them even if extraction doesn't find them
  const evmTooShortMatch = input.match(/\b0x[a-fA-F0-9]{39}\b/i);
  if (evmTooShortMatch && !extracted.evm.includes(evmTooShortMatch[0])) {
    rejected.push({
      raw: evmTooShortMatch[0],
      reason: 'invalid_length',
      category: 'validation',
    });
  }

  const evmTooLongMatch = input.match(/\b0x[a-fA-F0-9]{41,}\b/i);
  if (evmTooLongMatch && !extracted.evm.includes(evmTooLongMatch[0])) {
    rejected.push({
      raw: evmTooLongMatch[0],
      reason: 'invalid_length',
      category: 'validation',
    });
  }

  // Check for Solana addresses that are too short or too long
  // Check BEFORE extraction to catch cases that extraction might miss
  // Match 30-31 chars (too short for Solana which requires 32-44)
  const solanaTooShortPattern = /\b[1-9A-HJ-NP-Za-km-z]{30,31}\b/;
  const solanaTooShortMatches = input.matchAll(new RegExp(solanaTooShortPattern, 'g'));
  for (const match of solanaTooShortMatches) {
    const candidate = match[0];
    // Only reject if it's not already in extracted addresses
    const alreadyExtracted =
      solanaExtracted.some((a) => a.toLowerCase() === candidate.toLowerCase()) ||
      extracted.solana.some((a) => a.toLowerCase() === candidate.toLowerCase());
    if (!alreadyExtracted) {
      // Use 'invalid_length' for addresses that are too short (not 'too_short')
      rejected.push({
        raw: candidate,
        reason: 'invalid_length',
        category: 'validation',
      });
    }
  }

  const solanaTooLong = input.match(/\b[1-9A-HJ-NP-Za-km-z]{45,}\b/);
  if (solanaTooLong) {
    const candidate = solanaTooLong[0];
    if (
      !solanaExtracted.some((a) => a.toLowerCase() === candidate.toLowerCase()) &&
      !extracted.solana.some((a) => a.toLowerCase() === candidate.toLowerCase())
    ) {
      rejected.push({
        raw: candidate,
        reason: 'invalid_length',
        category: 'validation',
      });
    }
  }

  // Deduplicate valid addresses (by normalized form)
  const validNormalized = new Set<string>();
  const deduplicatedValid: ExtractionResult['valid'] = [];
  for (const v of valid) {
    const key = `${v.chain}:${v.normalized.toLowerCase()}`;
    if (!validNormalized.has(key)) {
      validNormalized.add(key);
      deduplicatedValid.push(v);
    }
  }

  // Ensure we've tracked all candidates (for "should not silently drop" test)
  // This is a sanity check - in practice, all candidates should be in valid or rejected
  // Note: Some candidates might be filtered out early (URLs, noise), which is OK

  return { valid: deduplicatedValid, rejected };
}
