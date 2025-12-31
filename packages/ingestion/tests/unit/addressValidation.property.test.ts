import { describe, it, expect } from 'vitest';
import { isEvmAddress, isSolanaAddress } from '@quantbot/utils';
import { extractAddresses } from '@quantbot/utils';

/**
 * Property tests for address validation
 *
 * These tests verify invariants and edge cases that should always hold true.
 */

describe('addressValidation - Property Tests', () => {
  describe('EVM address invariants', () => {
    it('should always require 0x prefix', () => {
      const valid = '0x' + 'a'.repeat(40);
      const invalid = 'a'.repeat(40);

      expect(isEvmAddress(valid)).toBe(true);
      expect(isEvmAddress(invalid)).toBe(false);
    });

    it('should always require exactly 40 hex characters after 0x', () => {
      const valid = '0x' + 'a'.repeat(40);
      const tooShort = '0x' + 'a'.repeat(39);
      const tooLong = '0x' + 'a'.repeat(41);

      expect(isEvmAddress(valid)).toBe(true);
      expect(isEvmAddress(tooShort)).toBe(false);
      expect(isEvmAddress(tooLong)).toBe(false);
    });

    it('should accept both uppercase and lowercase hex', () => {
      const lower = '0x' + 'a'.repeat(40);
      const upper = '0x' + 'A'.repeat(40);
      const mixed = '0x' + 'aA'.repeat(20);

      expect(isEvmAddress(lower)).toBe(true);
      expect(isEvmAddress(upper)).toBe(true);
      expect(isEvmAddress(mixed)).toBe(true);
    });

    it('should reject non-hex characters', () => {
      const withG = '0x' + 'a'.repeat(39) + 'g';
      const withZ = '0x' + 'a'.repeat(39) + 'z';

      expect(isEvmAddress(withG)).toBe(false);
      expect(isEvmAddress(withZ)).toBe(false);
    });

    it('should be case-insensitive for prefix (0x vs 0X)', () => {
      const lowerPrefix = '0x' + 'a'.repeat(40);
      const upperPrefix = '0X' + 'a'.repeat(40);

      expect(isEvmAddress(lowerPrefix)).toBe(true);
      expect(isEvmAddress(upperPrefix)).toBe(false); // Must be lowercase 0x
    });
  });

  describe('Solana address invariants', () => {
    it('should always require length between 32 and 44 characters', () => {
      const tooShort = '1'.repeat(31);
      const validMin = '1'.repeat(32);
      const validMax = '1'.repeat(44);
      const tooLong = '1'.repeat(45);

      expect(isSolanaAddress(tooShort)).toBe(false);
      expect(isSolanaAddress(validMin)).toBe(true);
      expect(isSolanaAddress(validMax)).toBe(true);
      expect(isSolanaAddress(tooLong)).toBe(false);
    });

    it('should reject forbidden base58 characters (0, O, I, l)', () => {
      const withZero = '1'.repeat(31) + '0';
      const withO = '1'.repeat(31) + 'O';
      const withI = '1'.repeat(31) + 'I';
      const withL = '1'.repeat(31) + 'l';

      expect(isSolanaAddress(withZero)).toBe(false);
      expect(isSolanaAddress(withO)).toBe(false);
      expect(isSolanaAddress(withI)).toBe(false);
      expect(isSolanaAddress(withL)).toBe(false);
    });

    it('should accept all valid base58 characters', () => {
      const validChars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
      const validAddress = validChars.substring(0, 32);

      expect(isSolanaAddress(validAddress)).toBe(true);
    });
  });

  describe('extractAddresses invariants', () => {
    it('should always return deduplicated addresses', () => {
      const text = `
        Address: 0x${'a'.repeat(40)}
        Same: 0x${'a'.repeat(40)}
        Different: 0x${'b'.repeat(40)}
      `;

      const result = extractAddresses(text);
      expect(result.evm.length).toBe(2); // Two unique addresses
    });

    it('should preserve first-seen order', () => {
      const text = `
        First: 0x${'1'.repeat(40)}
        Second: 0x${'2'.repeat(40)}
        Third: 0x${'3'.repeat(40)}
      `;

      const result = extractAddresses(text);
      expect(result.evm[0]).toBe('0x' + '1'.repeat(40));
      expect(result.evm[1]).toBe('0x' + '2'.repeat(40));
      expect(result.evm[2]).toBe('0x' + '3'.repeat(40));
    });

    it('should never extract invalid addresses', () => {
      const text = `
        Invalid: 0x${'g'.repeat(40)}
        Invalid: O0IlO0IlO0IlO0IlO0IlO0IlO0IlO0Il
      `;

      const result = extractAddresses(text);
      expect(result.evm.length).toBe(0);
      expect(result.solana.length).toBe(0);
    });

    it('should handle empty text gracefully', () => {
      const result = extractAddresses('');
      expect(result.evm).toEqual([]);
      expect(result.solana).toEqual([]);
    });

    it('should handle text with no addresses gracefully', () => {
      const text = 'This is just regular text with no addresses.';
      const result = extractAddresses(text);
      expect(result.evm).toEqual([]);
      expect(result.solana).toEqual([]);
    });

    it('should extract addresses from messy Unicode text', () => {
      const text = `
        🚨 NEW CA 🚨
        ├─ Sol: So11111111111111111111111111111111111111112
        └─ EVM: 0x${'a'.repeat(40)}
      `;

      const result = extractAddresses(text);
      expect(result.solana.length).toBeGreaterThan(0);
      expect(result.evm.length).toBeGreaterThan(0);
    });
  });

  describe('Edge cases', () => {
    it('should handle addresses at text boundaries', () => {
      const start = '0x' + 'a'.repeat(40) + ' rest of text';
      const end = 'text before 0x' + 'a'.repeat(40);
      const middle = 'before 0x' + 'a'.repeat(40) + ' after';

      expect(extractAddresses(start).evm.length).toBe(1);
      expect(extractAddresses(end).evm.length).toBe(1);
      expect(extractAddresses(middle).evm.length).toBe(1);
    });

    it('should handle addresses in URLs', () => {
      const url = 'https://pump.fun/So11111111111111111111111111111111111111112';
      const result = extractAddresses(url);
      expect(result.solana.length).toBeGreaterThan(0);
    });

    it('should handle addresses with surrounding punctuation', () => {
      const text = 'CA: (0x' + 'a'.repeat(40) + ')';
      const result = extractAddresses(text);
      expect(result.evm.length).toBe(1);
    });
  });
});
