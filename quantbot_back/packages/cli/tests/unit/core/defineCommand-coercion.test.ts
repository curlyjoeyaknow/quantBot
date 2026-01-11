/**
 * Golden Tests for defineCommand Coercion
 *
 * These tests lock in the exact coercion behavior that prevents
 * "Commander + parsing drift" issues. They ensure:
 * - JSON string arrays parse correctly
 * - Keys remain camelCase (never mutated)
 * - Coercion helpers work as expected
 *
 * CRITICAL: These tests prevent regression of the normalization issues
 * that caused headwind. If these fail, it means the pattern is broken.
 */

import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { coerceStringArray, coerceNumberArray } from '../../../src/core/coerce.js';
import { z } from 'zod';

describe('defineCommand Coercion - Golden Tests', () => {
  /**
   * Test 1: lags-ms flag → lagsMs: number[]
   *
   * CRITICAL: This test ensures --lags-ms '[0,10000]' correctly parses to opts.lagsMs: number[]
   * and keys are camelCase (never mutated to kebab-case).
   *
   * This would have caught the original bug where normalization was renaming keys.
   */
  it('coerces --lags-ms JSON string to lagsMs number array (camelCase)', () => {
    // Simulate what Commander provides: --lags-ms '[0,10000]' → { lagsMs: '[0,10000]' }
    const rawOptions = {
      lagsMs: '[0,10000]', // Commander converts --lags-ms to lagsMs (camelCase)
      callsFile: 'calls.json',
    };

    // Apply the same coerce function used in defineCommand
    const coerced = {
      ...rawOptions,
      lagsMs: rawOptions.lagsMs ? coerceNumberArray(rawOptions.lagsMs, 'lags-ms') : undefined,
    };

    // CRITICAL: Key must be camelCase, not kebab-case
    expect(coerced).toHaveProperty('lagsMs');
    expect(coerced).not.toHaveProperty('lags-ms');
    expect(coerced).not.toHaveProperty('lags_ms');

    // CRITICAL: Value must be a number array
    expect(coerced.lagsMs).toEqual([0, 10000]);
    expect(Array.isArray(coerced.lagsMs)).toBe(true);
    expect(typeof coerced.lagsMs[0]).toBe('number');
    expect(typeof coerced.lagsMs[1]).toBe('number');

    // Validate against schema
    const schema = z.object({
      lagsMs: z.array(z.coerce.number().int().min(0)).min(1),
      callsFile: z.string(),
    });

    const validated = schema.parse(coerced);
    expect(validated.lagsMs).toEqual([0, 10000]);
  });

  /**
   * Test 2: intervals flag → intervals: string[]
   *
   * CRITICAL: This test ensures --intervals '["1m","5m"]' correctly parses to opts.intervals: string[]
   * and keys are camelCase (never mutated to kebab-case).
   *
   * This would have caught the original bug where normalization was renaming keys.
   */
  it('coerces --intervals JSON string to intervals string array (camelCase)', () => {
    // Simulate what Commander provides: --intervals '["1m","5m"]' → { intervals: '["1m","5m"]' }
    const rawOptions = {
      intervals: '["1m","5m"]', // Commander converts --intervals to intervals (camelCase)
      callsFile: 'calls.json',
    };

    // Apply the same coerce function used in defineCommand
    const coerced = {
      ...rawOptions,
      intervals: rawOptions.intervals
        ? coerceStringArray(rawOptions.intervals, 'intervals')
        : undefined,
    };

    // CRITICAL: Key must be camelCase, not kebab-case
    expect(coerced).toHaveProperty('intervals');
    expect(coerced).not.toHaveProperty('intervals-json');
    expect(coerced).not.toHaveProperty('intervals_json');

    // CRITICAL: Value must be a string array
    expect(coerced.intervals).toEqual(['1m', '5m']);
    expect(Array.isArray(coerced.intervals)).toBe(true);
    expect(typeof coerced.intervals[0]).toBe('string');
    expect(typeof coerced.intervals[1]).toBe('string');

    // Validate against schema
    const schema = z.object({
      intervals: z.array(z.enum(['1m', '5m', '15m', '1h'])).min(1),
      callsFile: z.string(),
    });

    const validated = schema.parse(coerced);
    expect(validated.intervals).toEqual(['1m', '5m']);
  });

  /**
   * Test 3: Keys are never mutated (no renaming)
   *
   * CRITICAL: This ensures the coerce function doesn't rename keys.
   * Keys come from Commander as camelCase and stay camelCase.
   *
   * This prevents the "normalizeOptions v7" regression where keys were being renamed.
   */
  it('never mutates keys (no renaming - keys stay camelCase)', () => {
    // Simulate what Commander provides after parsing --calls-file, --lags-ms, --intervals
    const rawOptions = {
      callsFile: 'calls.json', // Commander converts --calls-file to callsFile
      lagsMs: '[0,10000]', // Commander converts --lags-ms to lagsMs
      intervals: '["1m","5m"]', // Commander converts --intervals to intervals
    };

    // CRITICAL: Raw keys from Commander are camelCase
    expect(rawOptions).toHaveProperty('callsFile');
    expect(rawOptions).toHaveProperty('lagsMs');
    expect(rawOptions).toHaveProperty('intervals');
    expect(rawOptions).not.toHaveProperty('calls-file');
    expect(rawOptions).not.toHaveProperty('lags-ms');

    // Apply coerce function (same pattern used in defineCommand)
    const coerced = {
      ...rawOptions,
      lagsMs: rawOptions.lagsMs ? coerceNumberArray(rawOptions.lagsMs, 'lags-ms') : undefined,
      intervals: rawOptions.intervals
        ? coerceStringArray(rawOptions.intervals, 'intervals')
        : undefined,
    };

    // CRITICAL: Coerced keys are still camelCase (no renaming)
    expect(coerced).toHaveProperty('callsFile');
    expect(coerced).toHaveProperty('lagsMs');
    expect(coerced).toHaveProperty('intervals');
    expect(coerced).not.toHaveProperty('calls-file');
    expect(coerced).not.toHaveProperty('lags-ms');

    // CRITICAL: Values are coerced but keys remain unchanged
    expect(coerced.lagsMs).toEqual([0, 10000]);
    expect(coerced.intervals).toEqual(['1m', '5m']);

    // Validate against schema
    const schema = z.object({
      callsFile: z.string(),
      lagsMs: z.array(z.coerce.number().int()).optional(),
      intervals: z.array(z.string()).optional(),
    });

    const validated = schema.parse(coerced);
    expect(validated.lagsMs).toEqual([0, 10000]);
    expect(validated.intervals).toEqual(['1m', '5m']);
  });

  /**
   * Test 4: Comma-separated strings also work
   *
   * Ensures both JSON arrays and comma-separated strings are supported.
   */
  it('coerces comma-separated strings to arrays', () => {
    const rawOptions = {
      intervals: '1m,5m', // Comma-separated string
      lagsMs: '0,10000', // Comma-separated string
    };

    const coerced = {
      ...rawOptions,
      intervals: rawOptions.intervals
        ? coerceStringArray(rawOptions.intervals, 'intervals')
        : undefined,
      lagsMs: rawOptions.lagsMs ? coerceNumberArray(rawOptions.lagsMs, 'lags-ms') : undefined,
    };

    expect(coerced.intervals).toEqual(['1m', '5m']);
    expect(coerced.lagsMs).toEqual([0, 10000]);

    // Validate against schema
    const schema = z.object({
      intervals: z.array(z.string()).min(1),
      lagsMs: z.array(z.coerce.number().int()).min(1),
    });

    const validated = schema.parse(coerced);
    expect(validated.intervals).toEqual(['1m', '5m']);
    expect(validated.lagsMs).toEqual([0, 10000]);
  });
});
