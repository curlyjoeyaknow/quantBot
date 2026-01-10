/**
 * Property tests for Mint Address Validation
 *
 * Critical invariants:
 * - Case preservation: exact case must be preserved
 * - Length validation: 32-44 characters
 * - No truncation: full address preserved
 * - Idempotency: validating same address twice = same result
 */

import { describe, it, expect } from 'vitest';
import { validateMintAddress } from '../../src/core/argument-parser';

describe('Mint Address Validation - Property Tests', () => {
  describe('Case Preservation Invariant', () => {
    it('should preserve exact case for valid addresses', () => {
      const testCases = [
        {
          address: 'So11111111111111111111111111111111111111112',
          expected: 'So11111111111111111111111111111111111111112',
        },
        {
          address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          expected: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        },
      ];

      for (const { address, expected } of testCases) {
        if (address.length >= 32 && address.length <= 44) {
          const result = validateMintAddress(address);
          expect(result).toBe(expected);
          // Verify case is preserved (not lowercased or uppercased)
          if (address !== address.toLowerCase()) {
            expect(result).not.toBe(address.toLowerCase());
          }
          if (address !== address.toUpperCase()) {
            expect(result).not.toBe(address.toUpperCase());
          }
        }
      }
    });

    it('should preserve mixed case exactly', () => {
      const mixedCase = 'So11111111111111111111111111111111111111112';
      const result = validateMintAddress(mixedCase);
      expect(result).toBe(mixedCase);
      expect(result[0]).toBe('S');
      expect(result[1]).toBe('o');
    });
  });

  describe('Base58 Decode Validation (Upgraded)', () => {
    it('should accept valid Solana addresses (base58 → 32 bytes)', () => {
      // These are real Solana addresses that decode to exactly 32 bytes
      const validAddresses = [
        'So11111111111111111111111111111111111111112', // Wrapped SOL
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
      ];

      for (const address of validAddresses) {
        const result = validateMintAddress(address);
        expect(result).toBe(address); // Exact case preserved
      }
    });

    it('should reject invalid base58 strings', () => {
      const invalidBase58 = [
        'O0Il', // Ambiguous characters not in base58 alphabet
        '!!!invalid!!!', // Special characters
        'test@address', // Invalid characters
      ];

      for (const address of invalidBase58) {
        expect(() => validateMintAddress(address)).toThrow(/base58|bytes|string/i);
      }
    });

    it('should reject addresses that decode to wrong length', () => {
      const wrongLength = '111111111111111111111'; // Valid base58 but wrong length
      expect(() => validateMintAddress(wrongLength)).toThrow(/32|bytes|length/i);
    });
  });

  describe('No Truncation Invariant', () => {
    it('should preserve full address without truncation', () => {
      const longAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // 44 chars
      const result = validateMintAddress(longAddress);
      expect(result.length).toBe(44);
      expect(result).toBe(longAddress);
      expect(result).not.toBe(longAddress.substring(0, 32));
    });

    it('should preserve all characters including special ones', () => {
      const address = 'So11111111111111111111111111111111111111112';
      const result = validateMintAddress(address);
      expect(result).toBe(address);
      expect(result).toContain('S');
      expect(result).toContain('o');
      expect(result).toContain('1');
    });
  });

  describe('Idempotency Invariant', () => {
    it('should return same result when validating same address twice', () => {
      const address = 'So11111111111111111111111111111111111111112';
      const result1 = validateMintAddress(address);
      const result2 = validateMintAddress(address);

      expect(result1).toBe(result2);
      expect(result1).toBe(address);
      expect(result2).toBe(address);
    });

    it('should be idempotent for multiple validations', () => {
      const address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      const results = Array.from({ length: 10 }, () => validateMintAddress(address));

      for (const result of results) {
        expect(result).toBe(address);
      }

      // All results should be identical
      expect(new Set(results).size).toBe(1);
    });
  });

  describe('Whitespace Handling', () => {
    it('should trim whitespace but preserve case', () => {
      const address = '  So11111111111111111111111111111111111111112  ';
      const trimmed = 'So11111111111111111111111111111111111111112';
      const result = validateMintAddress(address);

      expect(result).toBe(trimmed);
      expect(result.length).toBe(trimmed.length);
      expect(result[0]).toBe('S');
    });

    it('should preserve case after trimming', () => {
      const address = '  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v  ';
      const trimmed = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      const result = validateMintAddress(address);

      expect(result).toBe(trimmed);
      expect(result[0]).toBe('E');
      expect(result[1]).toBe('P');
      expect(result[2]).toBe('j');
    });
  });

  describe('Type Safety', () => {
    it('should reject non-string inputs', () => {
      expect(() => validateMintAddress(null as unknown as string)).toThrow();
      expect(() => validateMintAddress(undefined as unknown as string)).toThrow();
      expect(() => validateMintAddress(123 as unknown as string)).toThrow();
      expect(() => validateMintAddress({} as unknown as string)).toThrow();
      expect(() => validateMintAddress([] as unknown as string)).toThrow();
    });
  });
});
