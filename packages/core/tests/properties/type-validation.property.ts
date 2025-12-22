/**
 * Property Tests for Type Validation
 * ===================================
 *
 * Tests critical invariants for mint address handling using property-based testing.
 *
 * Critical Invariants:
 * 1. Mint addresses preserve exact case and length
 * 2. Mint addresses are never truncated
 * 3. Validation is consistent (same input = same output)
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';
import { createTokenAddress, type TokenAddress } from '../../src/index';

describe('createTokenAddress - Property Tests', () => {
  describe('Mint Address Preservation (Critical Invariant)', () => {
    it('preserves exact case and length for any valid address', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 32, maxLength: 44 }), (address) => {
          const result = createTokenAddress(address);
          // Must preserve exact case and length
          return result === address && result.length === address.length;
        }),
        { numRuns: 1000 }
      );
    });

    it('never truncates addresses during validation', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 32, maxLength: 44 }), (address) => {
          const result = createTokenAddress(address);
          // Length must be preserved exactly
          return result.length === address.length;
        }),
        { numRuns: 1000 }
      );
    });

    it('preserves mixed case addresses exactly', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 32, maxLength: 44 }), (baseAddress) => {
          // Create mixed case version
          const mixedCase = baseAddress
            .split('')
            .map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()))
            .join('');

          const result = createTokenAddress(mixedCase);
          // Must preserve exact case
          return result === mixedCase;
        }),
        { numRuns: 500 }
      );
    });
  });

  describe('Validation Consistency', () => {
    it('is idempotent: createTokenAddress(createTokenAddress(x)) = createTokenAddress(x)', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 32, maxLength: 44 }), (address) => {
          const first = createTokenAddress(address);
          const second = createTokenAddress(first);
          // Applying twice should give same result
          return first === second;
        }),
        { numRuns: 1000 }
      );
    });

    it('rejects invalid lengths consistently', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.string({ maxLength: 31 }), // Too short
            fc.string({ minLength: 45 }) // Too long
          ),
          (invalidAddress) => {
            // Should always throw for invalid length
            try {
              createTokenAddress(invalidAddress);
              return false; // Should have thrown
            } catch (error) {
              return error instanceof Error && error.message.includes('length');
            }
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  describe('Bounds Checking', () => {
    it('accepts addresses at minimum length (32 chars)', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 32, maxLength: 32 }), (address) => {
          const result = createTokenAddress(address);
          return result.length === 32;
        }),
        { numRuns: 100 }
      );
    });

    it('accepts addresses at maximum length (44 chars)', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 44, maxLength: 44 }), (address) => {
          const result = createTokenAddress(address);
          return result.length === 44;
        }),
        { numRuns: 100 }
      );
    });
  });
});
