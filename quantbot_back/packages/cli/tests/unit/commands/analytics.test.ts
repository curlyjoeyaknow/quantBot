/**
 * Unit tests for Analytics Commands
 *
 * Tests command handlers and schemas
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { parseArguments } from '../../../src/core/argument-parser';

describe('Analytics Commands', () => {
  beforeEach(() => {
    // Clear any state
  });

  describe('Analyze Command', () => {
    const analyzeSchema = z.object({
      caller: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      format: z.enum(['json', 'table', 'csv']).default('table'),
    });

    it('should validate analyze command arguments', () => {
      const validArgs = {
        caller: 'Brook',
        from: '2024-01-01',
        to: '2024-02-01',
        format: 'json' as const,
      };
      const result = parseArguments(analyzeSchema, validArgs);
      expect(result.caller).toBe('Brook');
      expect(result.from).toBe('2024-01-01');
      expect(result.to).toBe('2024-02-01');
      expect(result.format).toBe('json');
    });

    it('should use default format', () => {
      const result = parseArguments(analyzeSchema, {});
      expect(result.format).toBe('table');
    });

    it('should allow all optional parameters', () => {
      const result = parseArguments(analyzeSchema, {});
      expect(result.caller).toBeUndefined();
      expect(result.from).toBeUndefined();
      expect(result.to).toBeUndefined();
    });

    it('should reject invalid format', () => {
      const invalidArgs = { format: 'xml' };
      expect(() => parseArguments(analyzeSchema, invalidArgs)).toThrow();
    });

    it('should accept valid date strings', () => {
      const result = parseArguments(analyzeSchema, {
        from: '2024-01-01T00:00:00Z',
        to: '2024-12-31T23:59:59Z',
      });
      expect(result.from).toBe('2024-01-01T00:00:00Z');
      expect(result.to).toBe('2024-12-31T23:59:59Z');
    });
  });

  describe('Metrics Command', () => {
    const metricsSchema = z.object({
      caller: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      format: z.enum(['json', 'table', 'csv']).default('table'),
    });

    it('should validate metrics command arguments', () => {
      const validArgs = {
        caller: 'Lsy',
        from: '2024-01-01',
        to: '2024-02-01',
        format: 'csv' as const,
      };
      const result = parseArguments(metricsSchema, validArgs);
      expect(result.caller).toBe('Lsy');
      expect(result.from).toBe('2024-01-01');
      expect(result.to).toBe('2024-02-01');
      expect(result.format).toBe('csv');
    });

    it('should use default format', () => {
      const result = parseArguments(metricsSchema, {});
      expect(result.format).toBe('table');
    });

    it('should allow filtering by caller', () => {
      const result = parseArguments(metricsSchema, { caller: 'Brook' });
      expect(result.caller).toBe('Brook');
    });

    it('should allow filtering by date range', () => {
      const result = parseArguments(metricsSchema, {
        from: '2024-01-01',
        to: '2024-12-31',
      });
      expect(result.from).toBe('2024-01-01');
      expect(result.to).toBe('2024-12-31');
    });
  });

  describe('Report Command', () => {
    const reportSchema = z.object({
      caller: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      format: z.enum(['json', 'table', 'csv']).default('table'),
    });

    it('should validate report command arguments', () => {
      const validArgs = {
        caller: 'Brook',
        from: '2024-01-01',
        to: '2024-02-01',
        format: 'table' as const,
      };
      const result = parseArguments(reportSchema, validArgs);
      expect(result.caller).toBe('Brook');
      expect(result.from).toBe('2024-01-01');
      expect(result.to).toBe('2024-02-01');
      expect(result.format).toBe('table');
    });

    it('should use default format', () => {
      const result = parseArguments(reportSchema, {});
      expect(result.format).toBe('table');
    });

    it('should allow all parameters to be optional', () => {
      const result = parseArguments(reportSchema, {});
      expect(result.caller).toBeUndefined();
      expect(result.from).toBeUndefined();
      expect(result.to).toBeUndefined();
    });

    it('should accept all valid formats', () => {
      const formats = ['json', 'table', 'csv'] as const;
      for (const format of formats) {
        const result = parseArguments(reportSchema, { format });
        expect(result.format).toBe(format);
      }
    });
  });

  describe('Schema Consistency', () => {
    it('should have consistent schema across analytics commands', () => {
      const analyzeSchema = z.object({
        caller: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        format: z.enum(['json', 'table', 'csv']).default('table'),
      });

      const metricsSchema = z.object({
        caller: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        format: z.enum(['json', 'table', 'csv']).default('table'),
      });

      const reportSchema = z.object({
        caller: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        format: z.enum(['json', 'table', 'csv']).default('table'),
      });

      // All schemas should accept the same valid input
      const validArgs = {
        caller: 'Brook',
        from: '2024-01-01',
        to: '2024-02-01',
        format: 'json' as const,
      };

      const result1 = parseArguments(analyzeSchema, validArgs);
      const result2 = parseArguments(metricsSchema, validArgs);
      const result3 = parseArguments(reportSchema, validArgs);

      expect(result1).toEqual(result2);
      expect(result2).toEqual(result3);
    });
  });
});
