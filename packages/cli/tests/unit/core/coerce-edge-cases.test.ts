/**
 * Coercion Edge Cases and Error Handling Tests
 *
 * Tests all coercion helpers with edge cases, invalid inputs, and error scenarios.
 * Ensures robust error messages and proper type handling.
 */

import { describe, it, expect } from 'vitest';
import {
  coerceJson,
  coerceNumber,
  coerceNumberArray,
  coerceStringArray,
  coerceBoolean,
} from '../../../src/core/coerce.js';

describe('Coercion Edge Cases', () => {
  describe('coerceJson', () => {
    it('handles null and undefined', () => {
      expect(coerceJson<unknown>(null, 'test')).toBeUndefined();
      expect(coerceJson<unknown>(undefined, 'test')).toBeUndefined();
    });

    it('handles already parsed objects', () => {
      const obj = { key: 'value' };
      expect(coerceJson<typeof obj>(obj, 'test')).toBe(obj);
    });

    it('handles already parsed arrays', () => {
      const arr = [1, 2, 3];
      expect(coerceJson<typeof arr>(arr, 'test')).toBe(arr);
    });

    it('parses valid JSON strings', () => {
      expect(coerceJson<{ key: string }>('{"key":"value"}', 'test')).toEqual({ key: 'value' });
      expect(coerceJson<number[]>('[1,2,3]', 'test')).toEqual([1, 2, 3]);
    });

    it('throws informative error for invalid JSON', () => {
      expect(() => coerceJson<unknown>('{invalid json}', 'fieldName')).toThrow(
        /Invalid JSON for fieldName/
      );
      // JSON.parse error messages vary, just check it includes the error
      const error = () => coerceJson<unknown>('{invalid json}', 'fieldName');
      expect(error).toThrow();
    });

    it('includes input preview in error for long strings', () => {
      const longInvalidJson = '{'.repeat(100) + 'invalid';
      const error = () => coerceJson<unknown>(longInvalidJson, 'fieldName');
      expect(error).toThrow();
      expect(error).toThrow(/Input: /);
    });

    it('includes full input in error for short strings', () => {
      const shortInvalidJson = '{invalid}';
      expect(() => coerceJson<unknown>(shortInvalidJson, 'fieldName')).toThrow(
        /Input: \{invalid\}/
      );
    });
  });

  describe('coerceNumber', () => {
    it('handles null and undefined', () => {
      expect(coerceNumber(null, 'test')).toBeUndefined();
      expect(coerceNumber(undefined, 'test')).toBeUndefined();
    });

    it('handles already numbers', () => {
      expect(coerceNumber(42, 'test')).toBe(42);
      expect(coerceNumber(0, 'test')).toBe(0);
      expect(coerceNumber(-10, 'test')).toBe(-10);
      expect(coerceNumber(3.14, 'test')).toBe(3.14);
    });

    it('parses valid number strings', () => {
      expect(coerceNumber('42', 'test')).toBe(42);
      expect(coerceNumber('0', 'test')).toBe(0);
      expect(coerceNumber('-10', 'test')).toBe(-10);
      expect(coerceNumber('3.14', 'test')).toBe(3.14);
    });

    it('handles whitespace in number strings', () => {
      expect(coerceNumber('  42  ', 'test')).toBe(42);
      expect(coerceNumber('\t10\n', 'test')).toBe(10);
    });

    it('throws for invalid number strings', () => {
      expect(() => coerceNumber('not a number', 'fieldName')).toThrow(
        /Invalid number for fieldName/
      );
      expect(() => coerceNumber('', 'fieldName')).toThrow(/Invalid number for fieldName/);
    });

    it('throws for Infinity and NaN', () => {
      expect(() => coerceNumber('Infinity', 'fieldName')).toThrow(/Invalid number for fieldName/);
      expect(() => coerceNumber('NaN', 'fieldName')).toThrow(/Invalid number for fieldName/);
    });

    it('throws for non-string, non-number types', () => {
      expect(() => coerceNumber({}, 'fieldName')).toThrow(/Invalid number for fieldName/);
      expect(() => coerceNumber([], 'fieldName')).toThrow(/Invalid number for fieldName/);
      expect(() => coerceNumber(true, 'fieldName')).toThrow(/Invalid number for fieldName/);
    });
  });

  describe('coerceBoolean', () => {
    it('handles null and undefined', () => {
      expect(coerceBoolean(null, 'test')).toBeUndefined();
      expect(coerceBoolean(undefined, 'test')).toBeUndefined();
    });

    it('handles already booleans', () => {
      expect(coerceBoolean(true, 'test')).toBe(true);
      expect(coerceBoolean(false, 'test')).toBe(false);
    });

    it('handles numbers (1 = true, 0 = false)', () => {
      expect(coerceBoolean(1, 'test')).toBe(true);
      expect(coerceBoolean(0, 'test')).toBe(false);
      expect(coerceBoolean(-1, 'test')).toBe(true);
      expect(coerceBoolean(42, 'test')).toBe(true);
    });

    it('handles string "true" variations (case-insensitive)', () => {
      expect(coerceBoolean('true', 'test')).toBe(true);
      expect(coerceBoolean('TRUE', 'test')).toBe(true);
      expect(coerceBoolean('True', 'test')).toBe(true);
      expect(coerceBoolean('  true  ', 'test')).toBe(true);
    });

    it('handles string "false" variations (case-insensitive)', () => {
      expect(coerceBoolean('false', 'test')).toBe(false);
      expect(coerceBoolean('FALSE', 'test')).toBe(false);
      expect(coerceBoolean('False', 'test')).toBe(false);
      expect(coerceBoolean('  false  ', 'test')).toBe(false);
    });

    it('handles string "1" and "0"', () => {
      expect(coerceBoolean('1', 'test')).toBe(true);
      expect(coerceBoolean('0', 'test')).toBe(false);
      expect(coerceBoolean('  1  ', 'test')).toBe(true);
      expect(coerceBoolean('  0  ', 'test')).toBe(false);
    });

    it('handles string "yes" and "no" (case-insensitive)', () => {
      expect(coerceBoolean('yes', 'test')).toBe(true);
      expect(coerceBoolean('YES', 'test')).toBe(true);
      expect(coerceBoolean('Yes', 'test')).toBe(true);
      expect(coerceBoolean('no', 'test')).toBe(false);
      expect(coerceBoolean('NO', 'test')).toBe(false);
      expect(coerceBoolean('No', 'test')).toBe(false);
    });

    it('handles string "on" and "off" (case-insensitive)', () => {
      expect(coerceBoolean('on', 'test')).toBe(true);
      expect(coerceBoolean('ON', 'test')).toBe(true);
      expect(coerceBoolean('On', 'test')).toBe(true);
      expect(coerceBoolean('off', 'test')).toBe(false);
      expect(coerceBoolean('OFF', 'test')).toBe(false);
      expect(coerceBoolean('Off', 'test')).toBe(false);
    });

    it('throws for invalid boolean strings', () => {
      expect(() => coerceBoolean('maybe', 'fieldName')).toThrow(/Invalid boolean for fieldName/);
      expect(() => coerceBoolean('2', 'fieldName')).toThrow(/Invalid boolean for fieldName/);
      expect(() => coerceBoolean('', 'fieldName')).toThrow(/Invalid boolean for fieldName/);
    });

    it('throws for non-boolean, non-number, non-string types', () => {
      expect(() => coerceBoolean({}, 'fieldName')).toThrow(/Invalid boolean for fieldName/);
      expect(() => coerceBoolean([], 'fieldName')).toThrow(/Invalid boolean for fieldName/);
    });
  });

  describe('coerceNumberArray', () => {
    it('handles null and undefined', () => {
      expect(coerceNumberArray(null, 'test')).toBeUndefined();
      expect(coerceNumberArray(undefined, 'test')).toBeUndefined();
    });

    it('handles already arrays', () => {
      expect(coerceNumberArray([1, 2, 3], 'test')).toEqual([1, 2, 3]);
      expect(coerceNumberArray(['1', '2', '3'], 'test')).toEqual([1, 2, 3]);
    });

    it('parses JSON array strings', () => {
      expect(coerceNumberArray('[1,2,3]', 'test')).toEqual([1, 2, 3]);
      expect(coerceNumberArray('[0,10000,30000]', 'test')).toEqual([0, 10000, 30000]);
    });

    it('parses comma-separated strings', () => {
      expect(coerceNumberArray('1,2,3', 'test')).toEqual([1, 2, 3]);
      expect(coerceNumberArray('0,10000,30000', 'test')).toEqual([0, 10000, 30000]);
    });

    it('handles whitespace in comma-separated strings', () => {
      expect(coerceNumberArray('1, 2, 3', 'test')).toEqual([1, 2, 3]);
      expect(coerceNumberArray('  1  ,  2  ,  3  ', 'test')).toEqual([1, 2, 3]);
    });

    it('filters empty values in comma-separated strings', () => {
      expect(coerceNumberArray('1,,3', 'test')).toEqual([1, 3]);
      expect(coerceNumberArray(',1,2,', 'test')).toEqual([1, 2]);
    });

    it('throws for invalid array elements', () => {
      // JSON array with invalid element - will fail JSON parsing first
      expect(() => coerceNumberArray('[1,not,3]', 'fieldName')).toThrow();
      // Comma-separated with invalid element - will fail number parsing
      expect(() => coerceNumberArray('1,not,3', 'fieldName')).toThrow(/Invalid number/);
    });

    it('throws for invalid array format', () => {
      expect(() => coerceNumberArray({}, 'fieldName')).toThrow(/Invalid array for fieldName/);
      expect(() => coerceNumberArray(true, 'fieldName')).toThrow(/Invalid array for fieldName/);
    });
  });

  describe('coerceStringArray', () => {
    it('handles null and undefined', () => {
      expect(coerceStringArray(null, 'test')).toBeUndefined();
      expect(coerceStringArray(undefined, 'test')).toBeUndefined();
    });

    it('handles already arrays', () => {
      expect(coerceStringArray(['a', 'b', 'c'], 'test')).toEqual(['a', 'b', 'c']);
      expect(coerceStringArray([1, 2, 3], 'test')).toEqual(['1', '2', '3']); // Converts to strings
    });

    it('parses JSON array strings', () => {
      expect(coerceStringArray('["a","b","c"]', 'test')).toEqual(['a', 'b', 'c']);
      expect(coerceStringArray('["1m","5m","1h"]', 'test')).toEqual(['1m', '5m', '1h']);
    });

    it('parses comma-separated strings', () => {
      expect(coerceStringArray('a,b,c', 'test')).toEqual(['a', 'b', 'c']);
      expect(coerceStringArray('1m,5m,1h', 'test')).toEqual(['1m', '5m', '1h']);
    });

    it('handles whitespace in comma-separated strings', () => {
      expect(coerceStringArray('a, b, c', 'test')).toEqual(['a', 'b', 'c']);
      expect(coerceStringArray('  1m  ,  5m  ,  1h  ', 'test')).toEqual(['1m', '5m', '1h']);
    });

    it('filters empty values in comma-separated strings', () => {
      expect(coerceStringArray('a,,c', 'test')).toEqual(['a', 'c']);
      expect(coerceStringArray(',a,b,', 'test')).toEqual(['a', 'b']);
    });

    it('throws for invalid array format', () => {
      expect(() => coerceStringArray({}, 'fieldName')).toThrow(/Invalid array for fieldName/);
      expect(() => coerceStringArray(true, 'fieldName')).toThrow(/Invalid array for fieldName/);
    });
  });
});
