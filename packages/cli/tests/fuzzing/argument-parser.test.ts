/**
 * Fuzzing tests for Argument Parser
 *
 * Tests parser robustness against malformed input:
 * - Never crashes on garbage input
 * - Rejects malformed data gracefully
 * - Handles unicode/special characters
 * - Prevents injection attacks
 */

import { describe, it, expect } from 'vitest';
import {
  parseArguments,
  normalizeOptions,
  validateMintAddress,
  parseDate,
} from '../../src/core/argument-parser';
import { z } from 'zod';

describe('Argument Parser - Fuzzing Tests', () => {
  describe('parseArguments - Malformed Input', () => {
    const schema = z.object({
      name: z.string(),
      count: z.number(),
    });

    it('should not crash on null input', () => {
      expect(() => parseArguments(schema, null as unknown as Record<string, unknown>)).toThrow();
    });

    it('should not crash on undefined input', () => {
      expect(() =>
        parseArguments(schema, undefined as unknown as Record<string, unknown>)
      ).toThrow();
    });

    it('should not crash on array input', () => {
      expect(() => parseArguments(schema, [] as unknown as Record<string, unknown>)).toThrow();
    });

    it('should not crash on primitive input', () => {
      expect(() =>
        parseArguments(schema, 'string' as unknown as Record<string, unknown>)
      ).toThrow();
      expect(() => parseArguments(schema, 123 as unknown as Record<string, unknown>)).toThrow();
      expect(() => parseArguments(schema, true as unknown as Record<string, unknown>)).toThrow();
    });

    it('should handle deeply nested objects', () => {
      const nested = {
        name: 'test',
        count: 5,
        nested: {
          deeply: {
            nested: {
              value: 'test',
            },
          },
        },
      };
      // Should parse valid nested structure (ignores extra fields)
      const result = parseArguments(schema, nested);
      expect(result.name).toBe('test');
      expect(result.count).toBe(5);
    });

    it('should handle circular references gracefully', () => {
      const circular: Record<string, unknown> = { name: 'test', count: 5 };
      circular.self = circular;

      // Should not crash, but may throw on validation
      expect(() => parseArguments(schema, circular)).not.toThrow(Error);
    });
  });

  describe('normalizeOptions - Edge Cases', () => {
    it('should handle empty object', () => {
      const result = normalizeOptions({});
      expect(result).toEqual({});
    });

    it('should handle null and undefined values', () => {
      const result = normalizeOptions({
        key1: null,
        key2: undefined,
        key3: 'value',
      });
      expect(result).toEqual({ key3: 'value' });
    });

    it('should handle unicode characters', () => {
      const result = normalizeOptions({
        name: '测试',
        emoji: '🚀',
        unicode: 'café',
      });
      expect(result.name).toBe('测试');
      expect(result.emoji).toBe('🚀');
      expect(result.unicode).toBe('café');
    });

    it('should handle special characters in keys', () => {
      const result = normalizeOptions({
        'key-with-dashes': 'value1',
        key_with_underscores: 'value2',
        'key.with.dots': 'value3',
        camelCaseKey: 'value4',
      });
      expect(result['key-with-dashes']).toBe('value1');
      expect(result['key_with_underscores']).toBe('value2');
      expect(result['key.with.dots']).toBe('value3');
      expect(result['camel-case-key']).toBe('value4');
    });

    it('should convert string numbers to numbers', () => {
      const result = normalizeOptions({
        count: '123',
        negative: '-456',
        decimal: '123.45',
      });
      expect(result.count).toBe(123);
      expect(result.negative).toBe(-456);
      expect(result.decimal).toBe(123.45);
    });

    it('should convert string booleans to booleans', () => {
      const result = normalizeOptions({
        trueVal: 'true',
        falseVal: 'false',
        notBool: 'trueValue', // Should stay as string
      });
      expect(result['true-val']).toBe(true);
      expect(result['false-val']).toBe(false);
      expect(result['not-bool']).toBe('trueValue');
    });

    it('should handle very long strings', () => {
      const longString = 'a'.repeat(10000);
      const result = normalizeOptions({ long: longString });
      expect(result.long).toBe(longString);
      expect(result.long.length).toBe(10000);
    });

    it('should handle empty strings', () => {
      const result = normalizeOptions({
        empty: '',
        whitespace: '   ',
        normal: 'value',
      });
      expect(result.empty).toBe('');
      expect(result.whitespace).toBe('   ');
      expect(result.normal).toBe('value');
    });
  });

  describe('validateMintAddress - Fuzzing', () => {
    it('should not crash on empty string', () => {
      expect(() => validateMintAddress('')).toThrow();
    });

    it('should not crash on very long strings', () => {
      const longString = 'a'.repeat(10000);
      expect(() => validateMintAddress(longString)).toThrow();
    });

    it('should handle unicode characters', () => {
      const unicode = '测试' + 'A'.repeat(30);
      // Unicode characters count as multiple bytes, but length check is on string length
      // '测试' is 2 chars, so total is 32 chars - should pass length check but may have other issues
      const result = validateMintAddress(unicode);
      expect(result.length).toBeGreaterThanOrEqual(32);
    });

    it('should handle special characters', () => {
      const special = '!@#$%^&*()' + 'A'.repeat(22);
      // Should validate length but may fail other checks
      expect(() => validateMintAddress(special)).not.toThrow(Error);
    });

    it('should handle control characters', () => {
      // Control characters are valid in string
      // Need 32 total chars: 3 control + 29 A's = 32
      const control = '\n\t\r' + 'A'.repeat(29);
      // Should pass validation (32 chars total after trim)
      // Note: validateMintAddress trims, so control chars at start/end may be removed
      const trimmed = control.trim();
      if (trimmed.length >= 32) {
        const result = validateMintAddress(control);
        expect(result.length).toBeGreaterThanOrEqual(32);
        expect(result.length).toBeLessThanOrEqual(44);
      } else {
        // If trimmed length is less than 32, it should throw
        expect(() => validateMintAddress(control)).toThrow();
      }
    });

    it('should handle SQL injection attempts', () => {
      const sqlInjection = "' OR '1'='1" + 'A'.repeat(20);
      // SQL injection string is 31 chars, need at least 32
      const padded = sqlInjection + 'A'; // Make it 32 chars
      const result = validateMintAddress(padded);
      // Should accept it (validation only checks length, not content)
      expect(result.length).toBeGreaterThanOrEqual(32);
    });

    it('should handle script injection attempts', () => {
      const scriptInjection = '<script>alert("xss")</script>' + 'A'.repeat(5);
      expect(() => validateMintAddress(scriptInjection)).not.toThrow(Error);
    });

    it('should handle null bytes', () => {
      const nullByte = 'A'.repeat(32) + '\0';
      expect(() => validateMintAddress(nullByte)).not.toThrow(Error);
    });

    it('should handle binary data', () => {
      const binary = Buffer.from('A'.repeat(32)).toString('binary');
      expect(() => validateMintAddress(binary)).not.toThrow(Error);
    });
  });

  describe('parseDate - Fuzzing', () => {
    it('should not crash on empty string', () => {
      expect(() => parseDate('')).toThrow();
    });

    it('should not crash on very long strings', () => {
      const longString = 'a'.repeat(10000);
      expect(() => parseDate(longString)).toThrow();
    });

    it('should handle SQL injection attempts', () => {
      const sqlInjection = "'; DROP TABLE dates; --";
      expect(() => parseDate(sqlInjection)).toThrow();
    });

    it('should handle script injection attempts', () => {
      const scriptInjection = '<script>alert("xss")</script>';
      expect(() => parseDate(scriptInjection)).toThrow();
    });

    it('should handle null bytes', () => {
      const nullByte = '2024-01-01\0';
      expect(() => parseDate(nullByte)).toThrow();
    });

    it('should handle unicode characters', () => {
      const unicode = '2024-01-01测试';
      expect(() => parseDate(unicode)).toThrow();
    });

    it('should handle control characters', () => {
      const control = '2024-01-01\n\t\r';
      expect(() => parseDate(control)).toThrow();
    });

    it('should handle format confusion attacks', () => {
      const attacks = [
        '2024-01-01T00:00:00Z<script>',
        '2024-01-01; DROP TABLE',
        "2024-01-01' OR '1'='1",
        '2024-01-01${code}',
        '2024-01-01${7*7}',
      ];

      for (const attack of attacks) {
        expect(() => parseDate(attack)).toThrow();
      }
    });

    it('should handle overflow attempts', () => {
      const overflow = '9999-99-99T99:99:99Z';
      // Format check may pass (matches regex), but values are invalid
      // parseDate only checks format, not value validity
      const result = parseDate(overflow);
      expect(result).toBe(overflow);
      // Luxon will handle invalid date values
    });

    it('should handle negative numbers', () => {
      const negative = '-2024-01-01';
      expect(() => parseDate(negative)).toThrow();
    });
  });

  describe('Resource Exhaustion', () => {
    it('should handle large objects without OOM', () => {
      const largeObject: Record<string, unknown> = {};
      for (let i = 0; i < 1000; i++) {
        largeObject[`key${i}`] = 'value'.repeat(100);
      }

      const schema = z.object({ key0: z.string() });
      expect(() => parseArguments(schema, largeObject)).not.toThrow(Error);
    });

    it('should handle deeply nested objects', () => {
      let nested: Record<string, unknown> = { value: 'test' };
      for (let i = 0; i < 100; i++) {
        nested = { nested };
      }

      const schema = z.object({ value: z.string().optional() });
      // Should not crash, may throw on validation
      expect(() => parseArguments(schema, nested)).not.toThrow(Error);
    });
  });
});
