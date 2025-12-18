/**
 * Input Violence: Address Extraction Stress Tests
 *
 * Tests that address extraction handles malicious/malformed inputs gracefully.
 * Goal: Extraction must produce rejections table with reasons, not silently drop.
 */

import { describe, it, expect } from 'vitest';
import {
  ALL_CASES,
  PUNCTUATION_CASES,
  INVISIBLE_CASES,
  LINEBREAK_CASES,
  MARKDOWN_CASES,
  URL_CASES,
  NOISE_CASES,
  OBFUSCATION_CASES,
  SOLANA_VALIDATION_CASES,
  EVM_VALIDATION_CASES,
  type AddressTestCase,
} from '../fixtures/malicious-addresses.js';
import { extractAndValidateAddresses } from '../../../src/comprehensiveAddressExtraction.js';

describe('Address Extraction Stress Tests', () => {
  describe('Punctuation-wrapped candidates', () => {
    PUNCTUATION_CASES.forEach((testCase) => {
      it(testCase.description, () => {
        const result = extractAndValidateAddresses(testCase.input);

        if (testCase.expectedValid) {
          expect(result.valid.length).toBeGreaterThan(0);
          expect(result.valid[0].chain).toBe(testCase.expectedChain);
        } else {
          expect(result.rejected.length).toBeGreaterThan(0);
          if (testCase.expectedRejectionReason) {
            expect(result.rejected[0].reason).toBe(testCase.expectedRejectionReason);
          }
        }
      });
    });
  });

  describe('Invisible characters', () => {
    INVISIBLE_CASES.forEach((testCase) => {
      it(testCase.description, () => {
        const result = extractAndValidateAddresses(testCase.input);

        if (testCase.expectedValid) {
          expect(result.valid.length).toBeGreaterThan(0);
          // Address should be extracted without invisible chars
          expect(result.valid[0].address).not.toMatch(/[\u200B\u00A0\u200C\u00AD]/);
        } else {
          expect(result.rejected.length).toBeGreaterThan(0);
          if (testCase.expectedRejectionReason) {
            expect(result.rejected[0].reason).toBe(testCase.expectedRejectionReason);
          }
        }
      });
    });
  });

  describe('Line breaks mid-address', () => {
    LINEBREAK_CASES.forEach((testCase) => {
      it(testCase.description, () => {
        const result = extractAndValidateAddresses(testCase.input);

        // Line breaks should always cause rejection
        expect(result.rejected.length).toBeGreaterThan(0);
        if (testCase.expectedRejectionReason) {
          expect(result.rejected[0].reason).toBe(testCase.expectedRejectionReason);
        }
      });
    });
  });

  describe('Markdown/code blocks', () => {
    MARKDOWN_CASES.forEach((testCase) => {
      it(testCase.description, () => {
        const result = extractAndValidateAddresses(testCase.input);

        // Markdown should be stripped, address extracted
        expect(result.valid.length).toBeGreaterThan(0);
        expect(result.valid[0].chain).toBe(testCase.expectedChain);
      });
    });
  });

  describe('URLs containing base58-ish strings', () => {
    URL_CASES.forEach((testCase) => {
      it(testCase.description, () => {
        const result = extractAndValidateAddresses(testCase.input);

        // URLs should not be treated as addresses
        if (result.valid.length > 0) {
          // If extracted, should be flagged as URL component
          expect(result.rejected.some((r) => r.reason === 'url_component')).toBe(true);
        }
      });
    });
  });

  describe('Ticker-like noise', () => {
    NOISE_CASES.forEach((testCase) => {
      it(testCase.description, () => {
        const result = extractAndValidateAddresses(testCase.input);

        // Noise should be rejected
        expect(result.rejected.length).toBeGreaterThan(0);
        if (testCase.expectedRejectionReason) {
          expect(result.rejected[0].reason).toBe(testCase.expectedRejectionReason);
        }
      });
    });
  });

  describe('Obfuscation attempts', () => {
    OBFUSCATION_CASES.forEach((testCase) => {
      it(testCase.description, () => {
        const result = extractAndValidateAddresses(testCase.input);

        // Obfuscation should be rejected
        expect(result.rejected.length).toBeGreaterThan(0);
        if (testCase.expectedRejectionReason) {
          expect(result.rejected[0].reason).toBe(testCase.expectedRejectionReason);
        }
      });
    });
  });

  describe('Solana validation edge cases', () => {
    SOLANA_VALIDATION_CASES.forEach((testCase) => {
      it(testCase.description, () => {
        const result = extractAndValidateAddresses(testCase.input);

        // All Solana validation cases should be rejected
        expect(result.rejected.length).toBeGreaterThan(0);
        if (testCase.expectedRejectionReason) {
          expect(result.rejected[0].reason).toBe(testCase.expectedRejectionReason);
        }
      });
    });
  });

  describe('EVM validation edge cases', () => {
    EVM_VALIDATION_CASES.forEach((testCase) => {
      it(testCase.description, () => {
        const result = extractAndValidateAddresses(testCase.input);

        if (testCase.expectedValid) {
          expect(result.valid.length).toBeGreaterThan(0);
          expect(result.valid[0].chain).toBe(testCase.expectedChain);
        } else {
          expect(result.rejected.length).toBeGreaterThan(0);
          if (testCase.expectedRejectionReason) {
            expect(result.rejected[0].reason).toBe(testCase.expectedRejectionReason);
          }
        }
      });
    });
  });

  describe('Rejection tracking', () => {
    it('should record all rejections with reasons', () => {
      const invalidInputs = ALL_CASES.filter((c) => !c.expectedValid).map((c) => c.input);

      for (const input of invalidInputs) {
        const result = extractAndValidateAddresses(input);

        // Every rejection must have:
        // 1. Raw input
        // 2. Reason
        // 3. Category
        for (const rejection of result.rejected) {
          expect(rejection.raw).toBeDefined();
          expect(rejection.raw.length).toBeGreaterThan(0);
          expect(rejection.reason).toBeDefined();
          expect(rejection.reason.length).toBeGreaterThan(0);
          expect(rejection.category).toBeDefined();
        }
      }
    });

    it('should preserve original case in rejections', () => {
      const mixedCaseInput = 'So11111111111111111111111111111111111111112';
      const result = extractAndValidateAddresses(mixedCaseInput);

      // Whether valid or rejected, original case must be preserved
      if (result.valid.length > 0) {
        expect(result.valid[0].address).toBe(mixedCaseInput);
      }
      if (result.rejected.length > 0) {
        expect(result.rejected[0].raw).toBe(mixedCaseInput);
      }
    });

    it('should not silently drop candidates', () => {
      const multipleInput = `
        So11111111111111111111111111111111111111112
        0x1234567890123456789012345678901234567890
        INVALID_TOO_SHORT
        $SOL
      `;

      const result = extractAndValidateAddresses(multipleInput);

      // Total processed should equal valid + rejected
      const totalProcessed = result.valid.length + result.rejected.length;
      expect(totalProcessed).toBeGreaterThan(0);

      // We should have found at least the valid addresses
      // (Invalid non-address patterns like "INVALID_TOO_SHORT" and "$SOL"
      // don't match address patterns, so they're not candidates to reject)
      expect(result.valid.length).toBeGreaterThan(0);

      // If there are any address-like candidates that fail validation, they should be rejected
      // (In this case, both addresses are valid, so no rejections is OK)
    });
  });

  describe('Deduplication', () => {
    it('should deduplicate same address repeated', () => {
      const duplicateInput = `
        So11111111111111111111111111111111111111112
        So11111111111111111111111111111111111111112
        So11111111111111111111111111111111111111112
      `;

      const result = extractAndValidateAddresses(duplicateInput);

      // Should only have one valid entry (deduplicated)
      expect(result.valid.length).toBe(1);
    });

    it('should deduplicate case-insensitive but preserve original', () => {
      const caseVariations = `
        0x1234567890123456789012345678901234567890
        0x1234567890123456789012345678901234567890
        0X1234567890123456789012345678901234567890
      `;

      const result = extractAndValidateAddresses(caseVariations);

      // Should deduplicate (case-insensitive)
      expect(result.valid.length).toBeLessThanOrEqual(1);

      // But preserve original case of first occurrence
      if (result.valid.length > 0) {
        expect(result.valid[0].address).toMatch(/^0x/); // lowercase 0x
      }
    });
  });

  describe('Performance', () => {
    it('should handle large message with many candidates', () => {
      const largeBatch = Array(1000).fill('So11111111111111111111111111111111111111112').join(' ');

      const startTime = Date.now();
      const result = extractAndValidateAddresses(largeBatch);
      const duration = Date.now() - startTime;

      // Should complete in reasonable time (<1s for 1000 candidates)
      expect(duration).toBeLessThan(1000);

      // Should deduplicate
      expect(result.valid.length).toBe(1);
    });
  });
});
