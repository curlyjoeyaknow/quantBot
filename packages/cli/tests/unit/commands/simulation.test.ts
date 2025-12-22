/**
 * Unit tests for Simulation Commands
 *
 * Tests command handlers and schemas
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { parseArguments } from '../../../src/core/argument-parser';

describe('Simulation Commands', () => {
  beforeEach(() => {
    // Clear any state
  });

  describe('Run Command', () => {
    const runSchema = z.object({
      strategy: z.string().min(1),
      caller: z.string().optional(),
      from: z.string(),
      to: z.string(),
      format: z.enum(['json', 'table', 'csv']).default('table'),
    });

    it('should validate run command arguments', () => {
      const validArgs = {
        strategy: 'PT2_SL25',
        caller: 'Brook',
        from: '2024-01-01',
        to: '2024-02-01',
        format: 'json' as const,
      };
      const result = parseArguments(runSchema, validArgs);
      expect(result.strategy).toBe('PT2_SL25');
      expect(result.caller).toBe('Brook');
      expect(result.from).toBe('2024-01-01');
      expect(result.to).toBe('2024-02-01');
    });

    it('should use default format', () => {
      const result = parseArguments(runSchema, {
        strategy: 'PT2_SL25',
        from: '2024-01-01',
        to: '2024-02-01',
      });
      expect(result.format).toBe('table');
    });

    it('should reject empty strategy name', () => {
      const invalidArgs = { strategy: '', from: '2024-01-01', to: '2024-02-01' };
      expect(() => parseArguments(runSchema, invalidArgs)).toThrow();
    });

    it('should allow optional caller', () => {
      const result = parseArguments(runSchema, {
        strategy: 'PT2_SL25',
        from: '2024-01-01',
        to: '2024-02-01',
      });
      expect(result.caller).toBeUndefined();
    });

    it('should require from and to dates', () => {
      expect(() =>
        parseArguments(runSchema, { strategy: 'PT2_SL25', from: '2024-01-01' })
      ).toThrow();
      expect(() => parseArguments(runSchema, { strategy: 'PT2_SL25', to: '2024-02-01' })).toThrow();
    });
  });

  describe('List Runs Command', () => {
    const listRunsSchema = z.object({
      caller: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      limit: z.number().int().positive().max(1000).default(100),
      format: z.enum(['json', 'table', 'csv']).default('table'),
    });

    it('should validate list-runs command arguments', () => {
      const validArgs = {
        caller: 'Brook',
        from: '2024-01-01',
        to: '2024-02-01',
        limit: 50,
        format: 'json' as const,
      };
      const result = parseArguments(listRunsSchema, validArgs);
      expect(result.caller).toBe('Brook');
      expect(result.from).toBe('2024-01-01');
      expect(result.to).toBe('2024-02-01');
      expect(result.limit).toBe(50);
    });

    it('should use default limit and format', () => {
      const result = parseArguments(listRunsSchema, {});
      expect(result.limit).toBe(100);
      expect(result.format).toBe('table');
    });

    it('should reject negative limit', () => {
      const invalidArgs = { limit: -1 };
      expect(() => parseArguments(listRunsSchema, invalidArgs)).toThrow();
    });

    it('should reject limit exceeding maximum', () => {
      const invalidArgs = { limit: 2000 };
      expect(() => parseArguments(listRunsSchema, invalidArgs)).toThrow();
    });

    it('should accept valid limit range', () => {
      const result1 = parseArguments(listRunsSchema, { limit: 1 });
      expect(result1.limit).toBe(1);

      const result2 = parseArguments(listRunsSchema, { limit: 1000 });
      expect(result2.limit).toBe(1000);
    });

    it('should allow all optional parameters', () => {
      const result = parseArguments(listRunsSchema, {});
      expect(result.caller).toBeUndefined();
      expect(result.from).toBeUndefined();
      expect(result.to).toBeUndefined();
    });
  });

  describe('Extended Run Schema', () => {
    it('should validate extended run parameters', () => {
      const extendedSchema = z.object({
        strategy: z.string().min(1),
        from: z.string(),
        to: z.string(),
        interval: z.enum(['1m', '5m', '15m', '1h']).default('1m'),
        preWindow: z.coerce.number().int().min(0).default(0),
        postWindow: z.coerce.number().int().min(0).default(0),
        dryRun: z.boolean().default(false),
        concurrency: z.coerce.number().int().min(1).max(64).default(8),
      });

      const validArgs = {
        strategy: 'PT2_SL25',
        from: '2024-01-01',
        to: '2024-02-01',
        interval: '5m' as const,
        preWindow: 60,
        postWindow: 120,
        dryRun: true,
        concurrency: 16,
      };

      const result = parseArguments(extendedSchema, validArgs);
      expect(result.interval).toBe('5m');
      expect(result.preWindow).toBe(60);
      expect(result.postWindow).toBe(120);
      expect(result.dryRun).toBe(true);
      expect(result.concurrency).toBe(16);
    });

    it('should use default values for extended parameters', () => {
      const extendedSchema = z.object({
        strategy: z.string().min(1),
        from: z.string(),
        to: z.string(),
        interval: z.enum(['1m', '5m', '15m', '1h']).default('1m'),
        preWindow: z.coerce.number().int().min(0).default(0),
        postWindow: z.coerce.number().int().min(0).default(0),
        dryRun: z.boolean().default(false),
        concurrency: z.coerce.number().int().min(1).max(64).default(8),
      });

      const result = parseArguments(extendedSchema, {
        strategy: 'PT2_SL25',
        from: '2024-01-01',
        to: '2024-02-01',
      });

      expect(result.interval).toBe('1m');
      expect(result.preWindow).toBe(0);
      expect(result.postWindow).toBe(0);
      expect(result.dryRun).toBe(false);
      expect(result.concurrency).toBe(8);
    });

    it('should reject invalid interval', () => {
      const extendedSchema = z.object({
        strategy: z.string(),
        from: z.string(),
        to: z.string(),
        interval: z.enum(['1m', '5m', '15m', '1h']),
      });

      const invalidArgs = {
        strategy: 'PT2_SL25',
        from: '2024-01-01',
        to: '2024-02-01',
        interval: '30m',
      };

      expect(() => parseArguments(extendedSchema, invalidArgs)).toThrow();
    });

    it('should reject negative window values', () => {
      const extendedSchema = z.object({
        strategy: z.string(),
        from: z.string(),
        to: z.string(),
        preWindow: z.coerce.number().int().min(0),
      });

      const invalidArgs = {
        strategy: 'PT2_SL25',
        from: '2024-01-01',
        to: '2024-02-01',
        preWindow: -10,
      };

      expect(() => parseArguments(extendedSchema, invalidArgs)).toThrow();
    });

    it('should reject concurrency outside valid range', () => {
      const extendedSchema = z.object({
        strategy: z.string(),
        from: z.string(),
        to: z.string(),
        concurrency: z.coerce.number().int().min(1).max(64),
      });

      expect(() =>
        parseArguments(extendedSchema, {
          strategy: 'PT2_SL25',
          from: '2024-01-01',
          to: '2024-02-01',
          concurrency: 0,
        })
      ).toThrow();

      expect(() =>
        parseArguments(extendedSchema, {
          strategy: 'PT2_SL25',
          from: '2024-01-01',
          to: '2024-02-01',
          concurrency: 100,
        })
      ).toThrow();
    });
  });
});
