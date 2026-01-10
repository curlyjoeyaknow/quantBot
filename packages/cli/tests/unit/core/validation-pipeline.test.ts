/**
 * Validation Pipeline Tests
 *
 * Ensures all CLI arguments go through the unified validation pipeline.
 */

import { describe, it, expect } from 'vitest';
import { validateAndCoerceArgs } from '../../../src/core/validation-pipeline.js';
import { z } from 'zod';

describe('validateAndCoerceArgs', () => {
  it('should validate and coerce string to number', () => {
    const schema = z.object({
      count: z.number(),
    });

    const result = validateAndCoerceArgs(schema, { count: '42' });
    expect(result.count).toBe(42);
    expect(typeof result.count).toBe('number');
  });

  it('should validate and coerce string to boolean', () => {
    const schema = z.object({
      enabled: z.boolean(),
    });

    const result = validateAndCoerceArgs(schema, { enabled: 'true' });
    expect(result.enabled).toBe(true);
    expect(typeof result.enabled).toBe('boolean');
  });

  it('should preserve string values that are not numbers', () => {
    const schema = z.object({
      name: z.string(),
      id: z.string(),
    });

    const result = validateAndCoerceArgs(schema, {
      name: 'test',
      id: '12345678901234567890', // Long numeric string (ID)
    });

    expect(result.name).toBe('test');
    expect(result.id).toBe('12345678901234567890'); // Should remain string
  });

  it('should throw ValidationError for invalid arguments', () => {
    const schema = z.object({
      count: z.number().min(10),
    });

    expect(() => {
      validateAndCoerceArgs(schema, { count: '5' });
    }).toThrow();
  });

  it('should handle nested objects', () => {
    const schema = z.object({
      config: z.object({
        enabled: z.boolean(),
        count: z.number(),
      }),
    });

    const result = validateAndCoerceArgs(schema, {
      config: {
        enabled: 'true',
        count: '42',
      },
    });

    expect(result.config.enabled).toBe(true);
    expect(result.config.count).toBe(42);
  });

  it('should handle optional fields', () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional(),
    });

    const result1 = validateAndCoerceArgs(schema, { required: 'test' });
    expect(result1.required).toBe('test');
    expect(result1.optional).toBeUndefined();

    const result2 = validateAndCoerceArgs(schema, {
      required: 'test',
      optional: 'value',
    });
    expect(result2.optional).toBe('value');
  });
});
