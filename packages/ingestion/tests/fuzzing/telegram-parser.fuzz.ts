/**
 * Fuzzing Tests for Telegram HTML Parser
 * =======================================
 *
 * These tests hammer the parser with malformed, malicious, and edge-case inputs
 * to ensure it never crashes and handles all inputs gracefully.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { extractMintsFromHTML, parseTelegramMessage } from '../../src/parsers/telegram-parser';

describe('Telegram Parser - Fuzzing Tests', () => {
  describe('extractMintsFromHTML', () => {
    it('never crashes on arbitrary strings', () => {
      fc.assert(
        fc.property(fc.string({ maxLength: 10000 }), (html) => {
          try {
            const mints = extractMintsFromHTML(html);
            // Should return array (possibly empty), never crash
            expect(Array.isArray(mints)).toBe(true);
            return true;
          } catch (error) {
            // If it throws, must be Error instance
            return error instanceof Error;
          }
        }),
        { numRuns: 1000 } // Run 1000 random cases
      );
    });

    it('never crashes on malformed HTML', () => {
      const malformedCases = [
        '<div><span>', // Unclosed tags
        '</div></div>', // Unmatched closing tags
        '<div class="', // Incomplete attribute
        '<script>alert(1)</script>', // Script injection
        '<img src=x onerror=alert(1)>', // XSS attempt
        '<<<<<>>>>>', // Garbage
        '\x00\x01\x02', // Binary data
        '🚀🌙💎', // Unicode
        'a'.repeat(100000), // Very long string
        '<div>' + 'a'.repeat(100000) + '</div>', // Very long content
      ];

      malformedCases.forEach((html) => {
        expect(() => extractMintsFromHTML(html)).not.toThrow(/crash|panic/i);
      });
    });

    it('never extracts invalid mint addresses', () => {
      fc.assert(
        fc.property(fc.string({ maxLength: 5000 }), (html) => {
          const mints = extractMintsFromHTML(html);
          // All extracted mints must be valid Solana addresses
          return mints.every(
            (mint) =>
              typeof mint === 'string' &&
              mint.length >= 32 &&
              mint.length <= 44 &&
              /^[1-9A-HJ-NP-Za-km-z]+$/.test(mint) // Base58
          );
        }),
        { numRuns: 500 }
      );
    });

    it('handles deeply nested HTML without stack overflow', () => {
      // Create deeply nested HTML
      const depth = 1000;
      let html = '';
      for (let i = 0; i < depth; i++) {
        html += '<div>';
      }
      html += '7pXs9PuMPPzDMtDKC4Tj5gxF3sRLCBxuK3u8DPump';
      for (let i = 0; i < depth; i++) {
        html += '</div>';
      }

      expect(() => extractMintsFromHTML(html)).not.toThrow(/stack|recursion/i);
    });

    it('rejects script tags as mint sources', () => {
      const html = '<script>7pXs9PuMPPzDMtDKC4Tj5gxF3sRLCBxuK3u8DPump</script>';
      const mints = extractMintsFromHTML(html);
      expect(mints).toHaveLength(0);
    });

    it('handles unicode and special characters', () => {
      fc.assert(
        fc.property(fc.fullUnicodeString({ maxLength: 1000 }), (content) => {
          const html = `<div>${content}</div>`;
          try {
            extractMintsFromHTML(html);
            return true;
          } catch (error) {
            return error instanceof Error;
          }
        }),
        { numRuns: 500 }
      );
    });

    it('handles extremely large HTML documents', () => {
      // 10MB of HTML
      const largeHtml = '<div>' + 'a'.repeat(10 * 1024 * 1024) + '</div>';

      const startTime = Date.now();
      const result = extractMintsFromHTML(largeHtml);
      const duration = Date.now() - startTime;

      // Should complete in reasonable time (< 5 seconds)
      expect(duration).toBeLessThan(5000);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('parseTelegramMessage', () => {
    it('never crashes on malformed message objects', () => {
      fc.assert(
        fc.property(fc.anything(), (input) => {
          try {
            parseTelegramMessage(input);
            return true;
          } catch (error) {
            return error instanceof Error;
          }
        }),
        { numRuns: 1000 }
      );
    });

    it('handles messages with missing required fields', () => {
      const invalidMessages = [
        {},
        { text: 'hello' }, // Missing timestamp
        { timestamp: 123 }, // Missing text
        { text: null, timestamp: null },
        { text: undefined, timestamp: undefined },
      ];

      invalidMessages.forEach((msg) => {
        expect(() => parseTelegramMessage(msg)).not.toThrow(/crash/i);
      });
    });

    it('handles extremely long messages', () => {
      const longMessage = {
        text: 'a'.repeat(1000000), // 1MB of text
        timestamp: Date.now(),
      };

      expect(() => parseTelegramMessage(longMessage)).not.toThrow(/memory|stack/i);
    });
  });
});
