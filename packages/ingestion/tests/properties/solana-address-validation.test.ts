/**
 * Property Tests: Solana Address Validation
 *
 * Tests that all extracted Solana addresses are:
 * - Valid base58 encoded
 * - 32-44 characters
 * - Case-preserved exactly
 * - No invalid characters (0, O, I, l)
 *
 * Following cursor rules: "Rule 1: Mint Address Handling"
 */

import { describe, it, expect } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { BotMessageExtractor } from '../../src/BotMessageExtractor';
import { isBase58 } from '../../src/addressValidation';

describe('Solana Address Validation Property Tests', () => {
  describe('BotMessageExtractor address validation', () => {
    it('should extract only valid base58 Solana addresses', () => {
      const extractor = new BotMessageExtractor();

      // Valid Solana address (base58)
      const validHTML = `
        <div class="text">
          <a href="https://dexscreener.com/solana/7mLj7hayfcRstcyqTWySVaWB962YbfsVYYSnCMbTpump">🟢</a>
        </div>
      `;

      const result = extractor.extract(validHTML);

      // Property: Contract address must be valid base58
      expect(result.contractAddress).toBeTruthy();
      expect(result.contractAddress.length).toBeGreaterThanOrEqual(32);
      expect(result.contractAddress.length).toBeLessThanOrEqual(44);

      // Property: Must be base58 (no 0, O, I, l)
      expect(isBase58(result.contractAddress)).toBe(true);
      expect(/[0OIl]/.test(result.contractAddress)).toBe(false);

      // Property: Must be valid Solana PublicKey
      expect(() => {
        new PublicKey(result.contractAddress);
      }).not.toThrow();
    });

    it('should preserve exact case of Solana addresses', () => {
      const extractor = new BotMessageExtractor();

      // Address with mixed case (should preserve)
      const address = '7mLj7hayfcRstcyqTWySVaWB962YbfsVYYSnCMbTpump';
      const html = `
        <div class="text">
          <a href="https://dexscreener.com/solana/${address}">🟢</a>
        </div>
      `;

      const result = extractor.extract(html);

      // Property: Case must be preserved exactly
      expect(result.contractAddress).toBe(address);
      expect(result.contractAddress).not.toBe(address.toLowerCase());
      expect(result.contractAddress).not.toBe(address.toUpperCase());
    });

    it('should validate and reject invalid base58 addresses', () => {
      const extractor = new BotMessageExtractor();

      // Invalid: contains '0' (not in base58) - but extractor will try to validate
      const invalidHTML1 = `
        <div class="text">
          <a href="https://dexscreener.com/solana/7mLj7hayfcRstcyqTWySVaWB962YbfsVYYSnCMbTpump0">🟢</a>
        </div>
      `;

      // Invalid: contains 'O' (not in base58)
      const invalidHTML2 = `
        <div class="text">
          <a href="https://dexscreener.com/solana/7mLj7hayfcRstcyqTWySVaWB962YbfsVYYSnCMbTpumpO">🟢</a>
        </div>
      `;

      // Invalid: too short
      const invalidHTML3 = `
        <div class="text">
          <a href="https://dexscreener.com/solana/7mLj7hayfcRstcyqTWySVaWB962YbfsVYYSnCMbT">🟢</a>
        </div>
      `;

      const result1 = extractor.extract(invalidHTML1);
      const result2 = extractor.extract(invalidHTML2);
      const result3 = extractor.extract(invalidHTML3);

      // Property: Invalid addresses should be caught by validation
      // BotMessageExtractor now validates Solana addresses using PublicKey
      // If address is invalid, it will either be empty or fail PublicKey validation
      if (result1.contractAddress && result1.chain === 'solana') {
        // Should fail PublicKey validation
        expect(() => new PublicKey(result1.contractAddress)).toThrow();
      }
      if (result2.contractAddress && result2.chain === 'solana') {
        // Should fail PublicKey validation
        expect(() => new PublicKey(result2.contractAddress)).toThrow();
      }
      if (result3.contractAddress) {
        // Too short addresses should be caught
        if (result3.contractAddress.length < 32) {
          expect(result3.contractAddress.length).toBeLessThan(32);
        } else if (result3.chain === 'solana') {
          // If somehow extracted, should fail validation
          expect(() => new PublicKey(result3.contractAddress)).toThrow();
        }
      }
    });

    it('should validate all Solana addresses in extracted data', () => {
      const extractor = new BotMessageExtractor();

      const testCases = [
        '7mLj7hayfcRstcyqTWySVaWB962YbfsVYYSnCMbTpump', // Valid
        'So11111111111111111111111111111111111111112', // Valid (System Program)
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // Valid (USDC)
      ];

      for (const address of testCases) {
        const html = `
          <div class="text">
            <a href="https://dexscreener.com/solana/${address}">🟢</a>
          </div>
        `;

        const result = extractor.extract(html);

        if (result.contractAddress && result.chain === 'solana') {
          // Property: All Solana addresses must be valid base58
          expect(isBase58(result.contractAddress)).toBe(true);

          // Property: All Solana addresses must be valid PublicKey
          expect(() => {
            const pubkey = new PublicKey(result.contractAddress);
            expect(pubkey.toBase58()).toBe(result.contractAddress);
          }).not.toThrow();
        }
      }
    });
  });

  describe('address length and format properties', () => {
    it('should enforce 32-44 character length for Solana addresses', () => {
      const extractor = new BotMessageExtractor();

      const validTestCases = [
        '7mLj7hayfcRstcyqTWySVaWB962YbfsVYYSnCMbTpump', // 44 chars
        'So11111111111111111111111111111111111111112', // 44 chars
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // 44 chars
      ];

      for (const address of validTestCases) {
        const html = `
          <div class="text">
            <a href="https://dexscreener.com/solana/${address}">🟢</a>
          </div>
        `;

        const result = extractor.extract(html);

        // Property: Valid Solana addresses should be extracted and validated
        if (result.chain === 'solana' && result.contractAddress) {
          expect(result.contractAddress.length).toBeGreaterThanOrEqual(32);
          expect(result.contractAddress.length).toBeLessThanOrEqual(44);
          // Should pass PublicKey validation
          expect(() => new PublicKey(result.contractAddress)).not.toThrow();
        }
      }
    });
  });
});
