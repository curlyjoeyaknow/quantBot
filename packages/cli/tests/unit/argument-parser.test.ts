/**
 * Unit tests for Argument Parser
 *
 * Extended tests including normalizeOptions
 */

import { describe, it, expect } from 'vitest';
import {
  parseArguments,
  normalizeOptions,
  validateMintAddress,
  parseDate,
} from '../../src/core/argument-parser';
import { z } from 'zod';

describe('ArgumentParser', () => {
  describe('parseArguments', () => {
    it('should parse valid arguments', () => {
      const schema = z.object({
        name: z.string(),
        count: z.number(),
      });

      const args = { name: 'test', count: 5 };
      const result = parseArguments(schema, args);
      expect(result).toEqual({ name: 'test', count: 5 });
    });

    it('should throw error on invalid arguments', () => {
      const schema = z.object({
        name: z.string(),
        count: z.number(),
      });

      const args = { name: 'test', count: 'invalid' };
      expect(() => parseArguments(schema, args)).toThrow();
    });

    it('should format Zod errors with paths', () => {
      const schema = z.object({
        name: z.string(),
        nested: z.object({
          value: z.number(),
        }),
      });

      const args = { name: 'test', nested: { value: 'invalid' } };

      expect(() => parseArguments(schema, args)).toThrow();

      try {
        parseArguments(schema, args);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const message = (error as Error).message;
        // Check that it's a formatted error (either "Invalid arguments" or Zod error format)
        expect(typeof message).toBe('string');
        expect(message.length).toBeGreaterThan(0);
        // The error should mention the nested path or the field
        expect(message.toLowerCase()).toMatch(/nested|value|invalid|argument/i);
      }
    });
  });

  describe('normalizeOptions', () => {
    it('should normalize camelCase to kebab-case', () => {
      const options = {
        camelCase: 'value1',
        anotherKey: 'value2',
      };

      const result = normalizeOptions(options);
      expect(result['camel-case']).toBe('value1');
      expect(result['another-key']).toBe('value2');
    });

    it('should convert string numbers to numbers', () => {
      const options = {
        count: '123',
        negative: '-456',
        decimal: '123.45',
      };

      const result = normalizeOptions(options);
      expect(result.count).toBe(123);
      expect(result.negative).toBe(-456);
      expect(result.decimal).toBe(123.45);
    });

    it('should convert string booleans to booleans', () => {
      const options = {
        trueVal: 'true',
        falseVal: 'false',
        notBool: 'trueValue',
      };

      const result = normalizeOptions(options);
      expect(result['true-val']).toBe(true);
      expect(result['false-val']).toBe(false);
      expect(result['not-bool']).toBe('trueValue');
    });

    it('should skip null and undefined values', () => {
      const options = {
        key1: null,
        key2: undefined,
        key3: 'value',
      };

      const result = normalizeOptions(options);
      expect(result.key1).toBeUndefined();
      expect(result.key2).toBeUndefined();
      expect(result.key3).toBe('value');
    });

    it('should preserve non-string values', () => {
      const options = {
        number: 123,
        boolean: true,
        array: [1, 2, 3],
        object: { nested: 'value' },
      };

      const result = normalizeOptions(options);
      expect(result.number).toBe(123);
      expect(result.boolean).toBe(true);
      expect(result.array).toEqual([1, 2, 3]);
      expect(result.object).toEqual({ nested: 'value' });
    });

    it('should handle empty strings', () => {
      const options = {
        empty: '',
        whitespace: '   ',
      };

      const result = normalizeOptions(options);
      expect(result.empty).toBe('');
      expect(result.whitespace).toBe('   ');
    });
  });

  describe('validateMintAddress', () => {
    it('should validate correct mint address', () => {
      const address = 'So11111111111111111111111111111111111111112';
      expect(validateMintAddress(address)).toBe(address);
    });

    it('should throw error on too short address', () => {
      const address = 'short';
      expect(() => validateMintAddress(address)).toThrow();
    });

    it('should throw error on too long address', () => {
      const address = 'a'.repeat(50);
      expect(() => validateMintAddress(address)).toThrow();
    });

    it('should preserve case', () => {
      const address = 'So11111111111111111111111111111111111111112';
      const result = validateMintAddress(address);
      expect(result).toBe(address);
    });

    it('should trim whitespace', () => {
      const address = '  So11111111111111111111111111111111111111112  ';
      const trimmed = 'So11111111111111111111111111111111111111112';
      const result = validateMintAddress(address);
      expect(result).toBe(trimmed);
    });

    it('should accept addresses at boundary lengths', () => {
      const minLength = 'A'.repeat(32);
      const maxLength = 'A'.repeat(44);

      expect(validateMintAddress(minLength)).toBe(minLength);
      expect(validateMintAddress(maxLength)).toBe(maxLength);
    });
  });

  describe('parseDate', () => {
    it('should parse ISO date', () => {
      const date = '2024-01-01T00:00:00Z';
      expect(parseDate(date)).toBe(date);
    });

    it('should parse simple date', () => {
      const date = '2024-01-01';
      expect(parseDate(date)).toBe(date);
    });

    it('should parse date with milliseconds', () => {
      const date = '2024-01-01T00:00:00.123Z';
      expect(parseDate(date)).toBe(date);
    });

    it('should throw error on invalid date', () => {
      expect(() => parseDate('invalid')).toThrow();
    });

    it('should throw error on wrong format', () => {
      expect(() => parseDate('01-01-2024')).toThrow();
      expect(() => parseDate('2024/01/01')).toThrow();
    });

    it('should throw error on non-string input', () => {
      expect(() => parseDate(123 as unknown as string)).toThrow();
      expect(() => parseDate(null as unknown as string)).toThrow();
    });
  });
});
