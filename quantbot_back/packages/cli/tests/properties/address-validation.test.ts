/**
 * Property Tests for Chain-Aware Address Validation
 *
 * Tests critical invariants for Solana and EVM address validation
 */

import { describe, it, expect } from 'vitest';
import {
  validateSolanaAddress,
  validateEvmAddress,
  validateAddress,
  type Chain,
} from '../../src/core/address-validator';

describe('Address Validation - Property Tests', () => {
  describe('Solana Address Validation (Base58 Decode)', () => {
    // Known valid Solana addresses (32 bytes when decoded)
    const validSolanaAddresses = [
      'So11111111111111111111111111111111111111112', // Wrapped SOL
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
      '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', // Ether (Wormhole)
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
      'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // Marinade staked SOL
    ];

    // Invalid Solana addresses
    const invalidSolanaAddresses = [
      '', // Empty
      '   ', // Whitespace only
      'short', // Too short
      'So1111111111111111111111111111111111111111', // 43 chars but invalid base58
      '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb', // EVM address
      'invalid-base58-!!!', // Invalid base58 characters
      'O0Il', // Ambiguous base58 characters (O, 0, I, l not in base58)
    ];

    describe('Critical Invariants', () => {
      it('INVARIANT: Valid addresses decode to exactly 32 bytes', () => {
        for (const address of validSolanaAddresses) {
          const result = validateSolanaAddress(address);
          expect(result.valid).toBe(true);
          expect(result.address).toBeDefined();
          expect(result.chain).toBe('solana');
        }
      });

      it('INVARIANT: Case preservation (no toLowerCase/toUpperCase)', () => {
        const mixedCase = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
        const result = validateSolanaAddress(mixedCase);

        expect(result.valid).toBe(true);
        expect(result.address).toBe(mixedCase); // Exact case preserved
        expect(result.address).not.toBe(mixedCase.toLowerCase());
        expect(result.address).not.toBe(mixedCase.toUpperCase());
      });

      it('INVARIANT: Trimming only (no other transformations)', () => {
        const withSpaces = '  So11111111111111111111111111111111111111112  ';
        const result = validateSolanaAddress(withSpaces);

        expect(result.valid).toBe(true);
        expect(result.address).toBe(withSpaces.trim());
        expect(result.address).not.toContain(' ');
      });

      it('INVARIANT: Idempotency (validate(validate(x)) === validate(x))', () => {
        for (const address of validSolanaAddresses) {
          const result1 = validateSolanaAddress(address);
          const result2 = validateSolanaAddress(result1.address!);

          expect(result2.valid).toBe(true);
          expect(result2.address).toBe(result1.address);
        }
      });

      it('INVARIANT: Invalid base58 always rejected', () => {
        for (const address of invalidSolanaAddresses) {
          const result = validateSolanaAddress(address);
          expect(result.valid).toBe(false);
          expect(result.error).toBeDefined();
        }
      });

      it('INVARIANT: Decode length must be exactly 32 bytes', () => {
        // This address decodes but is not 32 bytes
        const invalidLength = '111111111111111111111111111111'; // Too short when decoded
        const result = validateSolanaAddress(invalidLength);

        expect(result.valid).toBe(false);
        expect(result.error).toContain('32');
      });
    });

    describe('Base58 Decode Validation', () => {
      it('should reject addresses with invalid base58 characters', () => {
        const invalidChars = ['O', '0', 'I', 'l']; // Not in base58 alphabet

        for (const char of invalidChars) {
          const address = `So1111111111111111111111111111111111111${char}`;
          const result = validateSolanaAddress(address);

          expect(result.valid).toBe(false);
          expect(result.error).toContain('base58');
        }
      });

      it('should reject addresses that decode to wrong length', () => {
        // This is a valid base58 string but decodes to wrong length
        // Using a shorter string that will decode but not to 32 bytes
        const shortAddress = '111111111111111111111'; // Too short
        const result = validateSolanaAddress(shortAddress);

        expect(result.valid).toBe(false);
        if (result.error) {
          expect(result.error).toMatch(/32|bytes|length|base58/i);
        }
      });
    });

    describe('Edge Cases', () => {
      it('should handle non-string inputs', () => {
        const inputs = [null, undefined, 123, {}, [], true];

        for (const input of inputs) {
          const result = validateSolanaAddress(input);
          expect(result.valid).toBe(false);
          expect(result.error).toContain('string');
        }
      });

      it('should handle empty and whitespace', () => {
        const inputs = ['', '   ', '\t', '\n'];

        for (const input of inputs) {
          const result = validateSolanaAddress(input);
          expect(result.valid).toBe(false);
        }
      });
    });
  });

  describe('EVM Address Validation (Ethereum, BSC, Base)', () => {
    // Known valid EVM addresses (must be exactly 42 chars: 0x + 40 hex)
    const validEvmAddresses = [
      '0x742d35cc6634c0532925a3b844bc9e7595f0beb0', // Valid format (lowercase)
      '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT on Ethereum
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC on Ethereum
      '0x0000000000000000000000000000000000000000', // Zero address
      '0x1111111111111111111111111111111111111111', // Test address
    ];

    // Invalid EVM addresses
    const invalidEvmAddresses = [
      '', // Empty
      '742d35Cc6634C0532925a3b844Bc9e7595f0bEb0', // Missing 0x
      '0x742d35Cc6634C0532925a3b844Bc9e7595f0b', // Too short (39 hex chars)
      '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEbE0', // Too long (41 hex chars)
      '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEG0', // Invalid hex (G)
      'So11111111111111111111111111111111111111112', // Solana address
    ];

    describe('Critical Invariants', () => {
      it('INVARIANT: Valid addresses are 0x + 40 hex chars', () => {
        for (const address of validEvmAddresses) {
          const result = validateEvmAddress(address, 'ethereum');

          expect(result.valid).toBe(true);
          expect(result.address).toBeDefined();
          expect(result.address!.length).toBe(42);
          expect(result.address!.startsWith('0x')).toBe(true);
        }
      });

      it('INVARIANT: Addresses are normalized to lowercase', () => {
        const uppercase = '0x742D35CC6634C0532925A3B844BC9E7595F0BEB0';
        const lowercase = '0x742d35cc6634c0532925a3b844bc9e7595f0beb0';
        const result = validateEvmAddress(uppercase, 'ethereum');

        expect(result.valid).toBe(true);
        expect(result.address).toBe(lowercase);
        expect(result.address).not.toBe(uppercase);
      });

      it('INVARIANT: Must start with 0x', () => {
        const without0x = '742d35Cc6634C0532925a3b844Bc9e7595f0bEb';
        const result = validateEvmAddress(without0x, 'ethereum');

        expect(result.valid).toBe(false);
        expect(result.error).toContain('0x');
      });

      it('INVARIANT: Must be exactly 42 characters', () => {
        const tooShort = '0x742d35cc6634c0532925a3b844bc9e7595f0b'; // 41 chars
        const tooLong = '0x742d35cc6634c0532925a3b844bc9e7595f0bebe0'; // 43 chars

        const shortResult = validateEvmAddress(tooShort, 'ethereum');
        const longResult = validateEvmAddress(tooLong, 'ethereum');

        expect(shortResult.valid).toBe(false);
        expect(shortResult.error).toContain('42');
        expect(longResult.valid).toBe(false);
        expect(longResult.error).toContain('42');
      });

      it('INVARIANT: Only hex characters allowed', () => {
        const invalidHex = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEG'; // G is not hex
        const result = validateEvmAddress(invalidHex, 'ethereum');

        expect(result.valid).toBe(false);
        expect(result.error).toContain('hex');
      });
    });

    describe('Chain-Specific Validation', () => {
      const testAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0';

      it('should validate for Ethereum', () => {
        const result = validateEvmAddress(testAddress, 'ethereum');
        expect(result.valid).toBe(true);
        expect(result.chain).toBe('ethereum');
      });

      it('should validate for BSC', () => {
        const result = validateEvmAddress(testAddress, 'bsc');
        expect(result.valid).toBe(true);
        expect(result.chain).toBe('bsc');
      });

      it('should validate for Base', () => {
        const result = validateEvmAddress(testAddress, 'base');
        expect(result.valid).toBe(true);
        expect(result.chain).toBe('base');
      });
    });

    describe('Edge Cases', () => {
      it('should handle non-string inputs', () => {
        const inputs = [null, undefined, 123, {}, [], true];

        for (const input of inputs) {
          const result = validateEvmAddress(input, 'ethereum');
          expect(result.valid).toBe(false);
          expect(result.error).toContain('string');
        }
      });

      it('should handle zero address', () => {
        const zeroAddress = '0x0000000000000000000000000000000000000000';
        const result = validateEvmAddress(zeroAddress, 'ethereum');

        expect(result.valid).toBe(true);
        expect(result.address).toBe(zeroAddress);
      });
    });
  });

  describe('Chain-Aware Validation', () => {
    it('should route to correct validator based on chain', () => {
      const solanaAddress = 'So11111111111111111111111111111111111111112';
      const evmAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0';

      // Solana
      const solResult = validateAddress(solanaAddress, 'solana');
      expect(solResult.valid).toBe(true);
      expect(solResult.chain).toBe('solana');

      // Ethereum
      const ethResult = validateAddress(evmAddress, 'ethereum');
      expect(ethResult.valid).toBe(true);
      expect(ethResult.chain).toBe('ethereum');

      // BSC
      const bscResult = validateAddress(evmAddress, 'bsc');
      expect(bscResult.valid).toBe(true);
      expect(bscResult.chain).toBe('bsc');

      // Base
      const baseResult = validateAddress(evmAddress, 'base');
      expect(baseResult.valid).toBe(true);
      expect(baseResult.chain).toBe('base');
    });

    it('should prevent cross-chain confusion', () => {
      const solanaAddress = 'So11111111111111111111111111111111111111112';
      const evmAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0';

      // Solana address on EVM chain should fail
      const solOnEvm = validateAddress(solanaAddress, 'ethereum');
      expect(solOnEvm.valid).toBe(false);

      // EVM address on Solana should fail
      const evmOnSol = validateAddress(evmAddress, 'solana');
      expect(evmOnSol.valid).toBe(false);
    });

    it('should handle unsupported chains gracefully', () => {
      const address = 'So11111111111111111111111111111111111111112';
      const result = validateAddress(address, 'unsupported' as Chain);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unsupported chain');
    });
  });

  describe('Security Properties', () => {
    it('should not leak sensitive information in errors', () => {
      const privateKey = '5J3mBbAH58CpQ3Y5RNJpUKPE62SQ5tfcvU2JpbnkeyhfsYB1Jcn';
      const result = validateSolanaAddress(privateKey);

      expect(result.valid).toBe(false);
      expect(result.error).not.toContain(privateKey);
    });

    it('should handle injection attempts safely', () => {
      const injectionAttempts = [
        "'; DROP TABLE addresses; --",
        '../../../etc/passwd',
        '<script>alert("xss")</script>',
        '${process.env.SECRET}',
      ];

      for (const attempt of injectionAttempts) {
        const result = validateSolanaAddress(attempt);
        expect(result.valid).toBe(false);
      }
    });
  });
});
