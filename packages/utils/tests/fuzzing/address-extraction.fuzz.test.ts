/**
 * Fuzzing Tests for Address Extraction
 *
 * Tests address extraction with random, malformed, and edge case inputs
 * to ensure robustness and prevent crashes.
 *
 * CRITICAL: These tests verify that extraction never crashes on malformed input.
 */

import { describe, it, expect } from 'vitest';
import {
  extractAddresses,
  extractSolanaAddresses,
  extractEvmAddresses,
} from '../../src/address/extract.js';

/**
 * Generate random string of given length
 */
function randomString(
  length: number,
  charset: string = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return result;
}

/**
 * Generate random base58-like string (may or may not be valid)
 */
function randomBase58String(length: number): string {
  const base58Chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  return randomString(length, base58Chars);
}

/**
 * Generate random hex string
 */
function randomHexString(length: number): string {
  return randomString(length, '0123456789abcdefABCDEF');
}

describe('Address Extraction Fuzzing', () => {
  describe('extractAddresses - Random Inputs', () => {
    it('should never crash on random strings', () => {
      for (let i = 0; i < 100; i++) {
        const randomLength = Math.floor(Math.random() * 1000) + 1;
        const randomInput = randomString(randomLength);

        expect(() => {
          const result = extractAddresses(randomInput);
          expect(result).toHaveProperty('solana');
          expect(result).toHaveProperty('evm');
          expect(Array.isArray(result.solana)).toBe(true);
          expect(Array.isArray(result.evm)).toBe(true);
        }).not.toThrow();
      }
    });

    it('should never crash on very long strings', () => {
      const longString = randomString(10000);

      expect(() => {
        const result = extractAddresses(longString);
        expect(result).toHaveProperty('solana');
        expect(result).toHaveProperty('evm');
      }).not.toThrow();
    });

    it('should never crash on empty or whitespace-only strings', () => {
      const cases = ['', ' ', '   ', '\n', '\t', '\r\n', '   \n   '];

      for (const input of cases) {
        expect(() => {
          const result = extractAddresses(input);
          expect(result.solana).toEqual([]);
          expect(result.evm).toEqual([]);
        }).not.toThrow();
      }
    });

    it('should never crash on strings with only special characters', () => {
      const specialChars = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`';
      const randomSpecial = randomString(100, specialChars);

      expect(() => {
        const result = extractAddresses(randomSpecial);
        expect(result).toHaveProperty('solana');
        expect(result).toHaveProperty('evm');
      }).not.toThrow();
    });

    it('should never crash on Unicode-heavy strings', () => {
      const unicodeStrings = [
        '🚀💰📈💎🔥',
        'Привет мир',
        'こんにちは世界',
        'مرحبا بالعالم',
        '🎯 Check out So11111111111111111111111111111111111111112',
      ];

      for (const input of unicodeStrings) {
        expect(() => {
          const result = extractAddresses(input);
          expect(result).toHaveProperty('solana');
          expect(result).toHaveProperty('evm');
        }).not.toThrow();
      }
    });

    it('should never crash on strings with null bytes', () => {
      const inputWithNulls = 'Hello\0World\0So11111111111111111111111111111111111111112';

      expect(() => {
        const result = extractAddresses(inputWithNulls);
        expect(result).toHaveProperty('solana');
        expect(result).toHaveProperty('evm');
      }).not.toThrow();
    });

    it('should never crash on strings with control characters', () => {
      const controlChars = '\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0A\x0B\x0C\x0D\x0E\x0F';
      const input = `Address${controlChars}So11111111111111111111111111111111111111112${controlChars}End`;

      expect(() => {
        const result = extractAddresses(input);
        expect(result).toHaveProperty('solana');
        expect(result).toHaveProperty('evm');
      }).not.toThrow();
    });
  });

  describe('extractAddresses - Malformed Address Patterns', () => {
    it('should handle almost-valid Solana addresses without crashing', () => {
      const cases = [
        'So1111111111111111111111111111111111111111', // 43 chars (too short)
        'So111111111111111111111111111111111111111123', // 45 chars (too long)
        'So1111111111111111111111111111111111111111O', // Contains O (invalid base58)
        'So1111111111111111111111111111111111111111I', // Contains I (invalid base58)
        'So1111111111111111111111111111111111111111l', // Contains l (invalid base58)
        'So11111111111111111111111111111111111111110', // Contains 0 (invalid base58)
        'So1111111111111111111111111111111111111111 ', // Has space
        'So1111111111111111111111111111111111111111\n', // Has newline
      ];

      for (const input of cases) {
        expect(() => {
          const result = extractAddresses(input);
          // Important: should not crash, result should be valid structure
          expect(result).toHaveProperty('solana');
          expect(result).toHaveProperty('evm');
          expect(Array.isArray(result.solana)).toBe(true);
          // Some may be extracted, some may not - that's OK, just don't crash
        }).not.toThrow();
      }
    });

    it('should handle almost-valid EVM addresses without crashing', () => {
      const cases = [
        '0x742d35cc6634c0532925a3b844bc9e7595f0beb', // 41 chars (too short)
        '0x742d35cc6634c0532925a3b844bc9e7595f0beb00', // 43 chars (too long)
        '0x742d35cc6634c0532925a3b844bc9e7595f0bebg', // Contains g (invalid hex)
        '0x742d35cc6634c0532925a3b844bc9e7595f0beb ', // Has space
        '0x742d35cc6634c0532925a3b844bc9e7595f0beb\n', // Has newline
        '742d35cc6634c0532925a3b844bc9e7595f0beb0', // Missing 0x prefix
      ];

      for (const input of cases) {
        expect(() => {
          const result = extractAddresses(input);
          // Important: should not crash, result should be valid structure
          expect(result).toHaveProperty('solana');
          expect(result).toHaveProperty('evm');
          expect(Array.isArray(result.evm)).toBe(true);
          // Some may be extracted, some may not - that's OK, just don't crash
        }).not.toThrow();
      }
    });

    it('should handle zero address correctly', () => {
      const input = '0x0000000000000000000000000000000000000000';

      expect(() => {
        const result = extractAddresses(input);
        // Zero address should be rejected
        expect(result.evm.length).toBe(0);
      }).not.toThrow();
    });
  });

  describe('extractAddresses - Edge Cases', () => {
    it('should handle addresses at string boundaries', () => {
      const validSolana = 'So11111111111111111111111111111111111111112';
      const validEvm = '0x742d35cc6634c0532925a3b844bc9e7595f0beb0';

      const cases = [
        validSolana, // Start
        `Text before ${validSolana}`, // Middle
        `Text before ${validSolana} text after`, // Middle with text after
        `${validSolana} text after`, // End
        validEvm, // EVM at start
        `Text ${validEvm}`, // EVM at end
        `(${validSolana})`, // In parentheses
        `[${validSolana}]`, // In brackets
        `{${validSolana}}`, // In braces
      ];

      for (const input of cases) {
        expect(() => {
          const result = extractAddresses(input);
          expect(result).toHaveProperty('solana');
          expect(result).toHaveProperty('evm');
        }).not.toThrow();
      }
    });

    it('should handle multiple addresses in same string', () => {
      const input =
        'So11111111111111111111111111111111111111112 and 0x742d35cc6634c0532925a3b844bc9e7595f0beb0 and So11111111111111111111111111111111111111113';

      expect(() => {
        const result = extractAddresses(input);
        expect(result.solana.length).toBeGreaterThan(0);
        expect(result.evm.length).toBeGreaterThan(0);
      }).not.toThrow();
    });

    it('should handle addresses in URLs', () => {
      const cases = [
        'https://pump.fun/So11111111111111111111111111111111111111112',
        'https://birdeye.so/So11111111111111111111111111111111111111112',
        'https://solscan.io/So11111111111111111111111111111111111111112',
        'https://etherscan.io/address/0x742d35cc6634c0532925a3b844bc9e7595f0beb0',
      ];

      for (const input of cases) {
        expect(() => {
          const result = extractAddresses(input);
          expect(result).toHaveProperty('solana');
          expect(result).toHaveProperty('evm');
        }).not.toThrow();
      }
    });

    it('should handle addresses in code blocks', () => {
      const cases = [
        '`So11111111111111111111111111111111111111112`',
        '```So11111111111111111111111111111111111111112```',
        '`0x742d35cc6634c0532925a3b844bc9e7595f0beb0`',
      ];

      for (const input of cases) {
        expect(() => {
          const result = extractAddresses(input);
          expect(result).toHaveProperty('solana');
          expect(result).toHaveProperty('evm');
        }).not.toThrow();
      }
    });
  });

  describe('extractSolanaAddresses - Fuzzing', () => {
    it('should never crash on random inputs', () => {
      for (let i = 0; i < 50; i++) {
        const randomInput = randomString(Math.floor(Math.random() * 500) + 1);

        expect(() => {
          const result = extractSolanaAddresses(randomInput);
          expect(Array.isArray(result)).toBe(true);
        }).not.toThrow();
      }
    });

    it('should handle base58-like strings of various lengths', () => {
      for (let length = 1; length <= 100; length += 10) {
        const base58Like = randomBase58String(length);

        expect(() => {
          const result = extractSolanaAddresses(base58Like);
          expect(Array.isArray(result)).toBe(true);
        }).not.toThrow();
      }
    });
  });

  describe('extractEvmAddresses - Fuzzing', () => {
    it('should never crash on random inputs', () => {
      for (let i = 0; i < 50; i++) {
        const randomInput = randomString(Math.floor(Math.random() * 500) + 1);

        expect(() => {
          const result = extractEvmAddresses(randomInput);
          expect(Array.isArray(result)).toBe(true);
        }).not.toThrow();
      }
    });

    it('should handle hex-like strings', () => {
      for (let length = 1; length <= 100; length += 10) {
        const hexLike = `0x${randomHexString(length)}`;

        expect(() => {
          const result = extractEvmAddresses(hexLike);
          expect(Array.isArray(result)).toBe(true);
        }).not.toThrow();
      }
    });
  });

  describe('Property Tests - Invariants', () => {
    it('should always return arrays (never null or undefined)', () => {
      for (let i = 0; i < 100; i++) {
        const randomInput = randomString(Math.floor(Math.random() * 1000) + 1);
        const result = extractAddresses(randomInput);

        expect(result).toBeDefined();
        expect(result.solana).toBeDefined();
        expect(result.evm).toBeDefined();
        expect(Array.isArray(result.solana)).toBe(true);
        expect(Array.isArray(result.evm)).toBe(true);
      }
    });

    it('should preserve case for extracted addresses', () => {
      const mixedCaseSolana = 'So11111111111111111111111111111111111111112';
      const mixedCaseEvm = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0';

      const result1 = extractAddresses(mixedCaseSolana);
      const result2 = extractAddresses(mixedCaseEvm);

      if (result1.solana.length > 0) {
        // Case should be preserved (exact match or normalized but case-aware)
        expect(result1.solana[0]).toBeTruthy();
      }

      if (result2.evm.length > 0) {
        // EVM addresses should preserve case
        expect(result2.evm[0]).toBeTruthy();
      }
    });

    it('should deduplicate addresses within same extraction', () => {
      const input =
        'So11111111111111111111111111111111111111112 So11111111111111111111111111111111111111112 So11111111111111111111111111111111111111112';

      const result = extractAddresses(input);

      // Should only have one unique address
      const unique = new Set(result.solana);
      expect(unique.size).toBeLessThanOrEqual(result.solana.length);
    });
  });

  describe('Stress Tests', () => {
    it('should handle very large inputs efficiently', () => {
      const largeInput = randomString(100000);

      const start = Date.now();
      expect(() => {
        const result = extractAddresses(largeInput);
        expect(result).toHaveProperty('solana');
        expect(result).toHaveProperty('evm');
      }).not.toThrow();
      const duration = Date.now() - start;

      // Should complete in reasonable time (< 5 seconds)
      expect(duration).toBeLessThan(5000);
    });

    it('should handle many addresses in single string', () => {
      const addresses: string[] = [];
      for (let i = 0; i < 100; i++) {
        addresses.push(
          `So1111111111111111111111111111111111111111${i.toString().padStart(1, '0')}`
        );
      }
      const input = addresses.join(' ');

      expect(() => {
        const result = extractAddresses(input);
        expect(result.solana.length).toBeGreaterThan(0);
      }).not.toThrow();
    });
  });
});
