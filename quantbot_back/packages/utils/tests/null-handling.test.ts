/**
 * Tests for null handling utilities
 */

import { describe, it, expect } from 'vitest';
import {
  isNotNull,
  isNullish,
  isNull,
  isUndefined,
  isNonEmptyString,
  isNonEmptyArray,
  isNonEmptyObject,
  assertNotNull,
  orDefault,
  orUndefined,
  orNull,
  safeGet,
  safeNestedGet,
  filterNullish,
  mapAndFilterNullish,
  firstNotNull,
  lastNotNull,
  requireNotNull,
  safeArrayGet,
  allNotNull,
  anyNotNull,
  coalesce,
  coalesceWithDefault,
} from '../src/null-handling.js';

describe('null-handling utilities', () => {
  describe('type guards', () => {
    it('isNotNull should identify non-null values', () => {
      expect(isNotNull(0)).toBe(true);
      expect(isNotNull('')).toBe(true);
      expect(isNotNull(false)).toBe(true);
      expect(isNotNull([])).toBe(true);
      expect(isNotNull({})).toBe(true);
      expect(isNotNull(null)).toBe(false);
      expect(isNotNull(undefined)).toBe(false);
    });

    it('isNullish should identify null/undefined', () => {
      expect(isNullish(null)).toBe(true);
      expect(isNullish(undefined)).toBe(true);
      expect(isNullish(0)).toBe(false);
      expect(isNullish('')).toBe(false);
    });

    it('isNonEmptyString should check for non-empty strings', () => {
      expect(isNonEmptyString('hello')).toBe(true);
      expect(isNonEmptyString('')).toBe(false);
      expect(isNonEmptyString(null)).toBe(false);
      expect(isNonEmptyString(undefined)).toBe(false);
      expect(isNonEmptyString(123)).toBe(false);
    });

    it('isNonEmptyArray should check for non-empty arrays', () => {
      expect(isNonEmptyArray([1, 2, 3])).toBe(true);
      expect(isNonEmptyArray([])).toBe(false);
      expect(isNonEmptyArray(null)).toBe(false);
      expect(isNonEmptyArray(undefined)).toBe(false);
    });

    it('isNonEmptyObject should check for non-empty objects', () => {
      expect(isNonEmptyObject({ a: 1 })).toBe(true);
      expect(isNonEmptyObject({})).toBe(false);
      expect(isNonEmptyObject(null)).toBe(false);
      expect(isNonEmptyObject([])).toBe(false); // Arrays are not objects
    });
  });

  describe('defaults', () => {
    it('orDefault should return default for null/undefined', () => {
      expect(orDefault(null, 0)).toBe(0);
      expect(orDefault(undefined, 0)).toBe(0);
      expect(orDefault(5, 0)).toBe(5);
      expect(orDefault('', 'default')).toBe('');
    });

    it('orUndefined should return undefined for null', () => {
      expect(orUndefined(null)).toBeUndefined();
      expect(orUndefined(undefined)).toBeUndefined();
      expect(orUndefined(5)).toBe(5);
    });

    it('orNull should return null for undefined', () => {
      expect(orNull(undefined)).toBeNull();
      expect(orNull(null)).toBeNull();
      expect(orNull(5)).toBe(5);
    });
  });

  describe('safe accessors', () => {
    it('safeGet should return default for null object', () => {
      expect(safeGet(null, 'key', 'default')).toBe('default');
      expect(safeGet(undefined, 'key', 'default')).toBe('default');
      expect(safeGet({ key: 'value' }, 'key', 'default')).toBe('value');
      expect(safeGet({ key: null }, 'key', 'default')).toBe('default');
    });

    it('safeNestedGet should access nested properties safely', () => {
      const obj = { a: { b: { c: 'value' } } };
      expect(safeNestedGet(obj, ['a', 'b', 'c'], 'default')).toBe('value');
      expect(safeNestedGet(obj, ['a', 'b', 'd'], 'default')).toBe('default');
      expect(safeNestedGet(null, ['a', 'b'], 'default')).toBe('default');
      expect(safeNestedGet({ a: null }, ['a', 'b'], 'default')).toBe('default');
    });

    it('safeArrayGet should access array elements safely', () => {
      expect(safeArrayGet([1, 2, 3], 0, 0)).toBe(1);
      expect(safeArrayGet([1, 2, 3], 10, 0)).toBe(0);
      expect(safeArrayGet(null, 0, 0)).toBe(0);
      expect(safeArrayGet([1, null, 3], 1, 0)).toBe(0);
    });
  });

  describe('array operations', () => {
    it('filterNullish should remove null/undefined', () => {
      expect(filterNullish([1, null, 2, undefined, 3])).toEqual([1, 2, 3]);
      expect(filterNullish([null, undefined])).toEqual([]);
      expect(filterNullish([1, 2, 3])).toEqual([1, 2, 3]);
    });

    it('mapAndFilterNullish should map and filter', () => {
      const items = [{ value: 1 }, { value: null }, { value: 2 }];
      expect(mapAndFilterNullish(items, (item) => item.value)).toEqual([1, 2]);
    });

    it('firstNotNull should return first non-null', () => {
      expect(firstNotNull([null, undefined, 1, 2])).toBe(1);
      expect(firstNotNull([null, undefined])).toBeUndefined();
    });

    it('lastNotNull should return last non-null', () => {
      expect(lastNotNull([1, 2, null, undefined])).toBe(2);
      expect(lastNotNull([null, undefined])).toBeUndefined();
    });

    it('allNotNull should check all values', () => {
      expect(allNotNull([1, 2, 3])).toBe(true);
      expect(allNotNull([1, null, 3])).toBe(false);
    });

    it('anyNotNull should check any value', () => {
      expect(anyNotNull([null, undefined, 1])).toBe(true);
      expect(anyNotNull([null, undefined])).toBe(false);
    });
  });

  describe('coalescing', () => {
    it('coalesce should return first non-null', () => {
      expect(coalesce(null, undefined, 1, 2)).toBe(1);
      expect(coalesce(null, undefined)).toBeUndefined();
    });

    it('coalesceWithDefault should return first non-null or default', () => {
      expect(coalesceWithDefault(0, null, undefined, 1, 2)).toBe(1);
      expect(coalesceWithDefault(0, null, undefined)).toBe(0);
    });
  });

  describe('assertions', () => {
    it('assertNotNull should throw for null/undefined', () => {
      expect(() => assertNotNull(null)).toThrow();
      expect(() => assertNotNull(undefined)).toThrow();
      expect(() => assertNotNull(5)).not.toThrow();
    });

    it('requireNotNull should throw with context', () => {
      expect(() => requireNotNull(null, { key: 'value' })).toThrow();
      expect(() => requireNotNull(5)).not.toThrow();
    });
  });
});
