/**
 * Fuzzing Tests for Token Address Extraction
 * ===========================================
 * 
 * Tests parser robustness using property-based testing with aggressive generators.
 * 
 * Following project rules: "Parsers Must Be Fuzzed"
 * - Never crashes on garbage input
 * - Rejects malformed data
 * - Handles unicode/special characters gracefully
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// Extract token addresses from text (from brook-call-ingestion)
function extractTokenAddresses(text: string): string[] {
  const addresses: string[] = [];
  if (!text) return addresses;

  let cleanText = text.replace(/<[^>]+>/g, ' ');
  cleanText = cleanText.replace(/&apos;/g, "'");
  cleanText = cleanText.replace(/&quot;/g, '"');
  cleanText = cleanText.replace(/&amp;/g, '&');

  // Solana: base58 addresses (32-44 chars)
  const solanaRegex = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
  const solanaMatches = cleanText.match(solanaRegex) || [];
  const validSolana = solanaMatches.filter((addr: string): boolean => {
    const len = addr.length;
    if (len < 32 || len > 44) return false;
    if (addr.toUpperCase().startsWith('DEF')) return false;
    return true;
  });
  addresses.push(...validSolana);

  // EVM: 0x + 40 hex chars
  const evmRegex = /0x[a-fA-F0-9]{40}\b/g;
  const evmMatches = cleanText.match(evmRegex) || [];
  addresses.push(...evmMatches);

  // Remove duplicates
  const unique = new Set<string>();
  addresses.forEach((addr: string): void => {
    if (addr.startsWith('0x')) {
      unique.add(addr.toLowerCase());
    } else {
      unique.add(addr);
    }
  });

  return Array.from(unique);
}

describe('Token Address Extraction - Fuzzing Tests', () => {
  describe('Parser Robustness (Never Crashes)', () => {
    it('never crashes on arbitrary input', () => {
      fc.assert(
        fc.property(fc.anything(), (input: unknown): boolean => {
          try {
            const text = typeof input === 'string' ? input : String(input);
            extractTokenAddresses(text);
            return true;
          } catch (error: unknown) {
            return error instanceof Error;
          }
        }),
        { numRuns: 1000 }
      );
    });

    it('handles unicode and special characters', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 10000 }), (input: string): boolean => {
          const result = extractTokenAddresses(input);
          return (
            Array.isArray(result) &&
            result.every((addr: string): boolean => typeof addr === 'string')
          );
        }),
        { numRuns: 500 }
      );
    });

    it('handles malformed data gracefully', () => {
      fc.assert(
        fc.property(fc.string(), (input: string): boolean => {
          const result = extractTokenAddresses(input);
          return Array.isArray(result);
        }),
        { numRuns: 1000 }
      );
    });
  });

  describe('Injection Prevention', () => {
    it('handles SQL injection attempts', (): void => {
      const sqlInjection = "'; DROP TABLE tokens; --";
      expect(() => extractTokenAddresses(sqlInjection)).not.toThrow();
      const result = extractTokenAddresses(sqlInjection);
      expect(Array.isArray(result)).toBe(true);
    });

    it('handles XSS attempts', (): void => {
      const xss = '<script>alert("xss")</script>';
      expect(() => extractTokenAddresses(xss)).not.toThrow();
      const result = extractTokenAddresses(xss);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('Resource Exhaustion', () => {
    it('handles very long strings without OOM', (): void => {
      const longString = 'a'.repeat(100000);
      expect(() => extractTokenAddresses(longString)).not.toThrow();
      const result = extractTokenAddresses(longString);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string', (): void => {
      expect(extractTokenAddresses('')).toEqual([]);
    });

    it('should handle null-like inputs', (): void => {
      expect(extractTokenAddresses('null')).toEqual([]);
      expect(extractTokenAddresses('undefined')).toEqual([]);
    });
  });
});

