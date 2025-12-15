/**
 * Type Validation Tests
 * =====================
 * Integration tests for type validation functions in @quantbot/core
 */

import { describe, it, expect } from 'vitest';
import { createTokenAddress, type TokenAddress } from '../src/index';

describe('createTokenAddress', () => {
  describe('valid addresses', () => {
    it('should accept a 32-character address', () => {
      const address = 'A'.repeat(32);
      const result = createTokenAddress(address);
      expect(result).toBe(address);
      expect(typeof result).toBe('string');
    });

    it('should accept a 44-character address', () => {
      const address = 'A'.repeat(44);
      const result = createTokenAddress(address);
      expect(result).toBe(address);
    });

    it('should accept addresses between 32-44 characters', () => {
      for (let len = 32; len <= 44; len++) {
        const address = 'A'.repeat(len);
        const result = createTokenAddress(address);
        expect(result).toBe(address);
      }
    });

    it('should preserve exact case of address', () => {
      const address = 'So11111111111111111111111111111111111111112';
      const result = createTokenAddress(address);
      expect(result).toBe(address);
    });

    it('should preserve special characters in base58 addresses', () => {
      const address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      const result = createTokenAddress(address);
      expect(result).toBe(address);
    });
  });

  describe('invalid addresses', () => {
    it('should reject addresses shorter than 32 characters', () => {
      const address = 'A'.repeat(31);
      expect(() => createTokenAddress(address)).toThrow(
        'Invalid mint address length: 31. Must be between 32 and 44 characters.'
      );
    });

    it('should reject addresses longer than 44 characters', () => {
      const address = 'A'.repeat(45);
      expect(() => createTokenAddress(address)).toThrow(
        'Invalid mint address length: 45. Must be between 32 and 44 characters.'
      );
    });

    it('should reject empty string', () => {
      expect(() => createTokenAddress('')).toThrow(
        'Invalid mint address length: 0. Must be between 32 and 44 characters.'
      );
    });

    it('should reject very short strings', () => {
      expect(() => createTokenAddress('abc')).toThrow();
    });

    it('should reject very long strings', () => {
      const address = 'A'.repeat(100);
      expect(() => createTokenAddress(address)).toThrow();
    });
  });

  describe('type safety', () => {
    it('should return a branded TokenAddress type', () => {
      const address = 'So11111111111111111111111111111111111111112';
      const result: TokenAddress = createTokenAddress(address);
      // TypeScript should enforce this is a TokenAddress, not just string
      expect(result).toBe(address);
    });

    it('should preserve address in assignments', () => {
      const address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      const tokenAddress: TokenAddress = createTokenAddress(address);
      const assigned: TokenAddress = tokenAddress;
      expect(assigned).toBe(address);
    });
  });
});
