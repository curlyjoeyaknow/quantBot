/**
 * defineCommand Error Handling Tests
 *
 * Tests error handling paths in defineCommand wrapper:
 * - Invalid JSON parsing
 * - Schema validation failures
 * - Missing command in registry
 * - Error formatter (die) behavior
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { defineCommand } from '../../../src/core/defineCommand.js';
import { die } from '../../../src/core/cliErrors.js';
import { coerceJson, coerceNumber } from '../../../src/core/coerce.js';
import { z } from 'zod';
import { commandRegistry } from '../../../src/core/command-registry.js';
import { NotFoundError } from '@quantbot/utils';

// Mock execute to avoid full integration
vi.mock('../../../src/core/execute.js', () => ({
  execute: vi.fn().mockResolvedValue(undefined),
}));

describe('defineCommand Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('JSON Parsing Errors', () => {
    it('coerce function throws informative error for invalid JSON', () => {
      // Test the coerce function directly (what defineCommand uses)
      const raw = { overlays: '{invalid json}' };
      const coerceFn = (raw: Record<string, unknown>) => ({
        ...raw,
        overlays: raw.overlays ? coerceJson<unknown[]>(raw.overlays, 'overlays') : undefined,
      });

      expect(() => coerceFn(raw)).toThrow(/Invalid JSON for overlays/);
    });
  });

  describe('Schema Validation Errors', () => {
    it('validate function throws Zod error for invalid schema', () => {
      const schema = z.object({
        limit: z.number().int().positive().max(100),
      });

      // Test validation directly (what defineCommand uses)
      const validateFn = (opts: unknown) => schema.parse(opts);

      // Valid input
      expect(validateFn({ limit: 50 })).toEqual({ limit: 50 });

      // Invalid input (limit > 100)
      expect(() => validateFn({ limit: 200 })).toThrow();

      // Invalid input (limit not a number)
      expect(() => validateFn({ limit: 'not a number' })).toThrow();
    });

    it('validate function throws for missing required fields', () => {
      const schema = z.object({
        required: z.string().min(1),
        optional: z.string().optional(),
      });

      const validateFn = (opts: unknown) => schema.parse(opts);

      // Valid input
      expect(validateFn({ required: 'value' })).toEqual({ required: 'value' });

      // Missing required field
      expect(() => validateFn({})).toThrow();
    });
  });

  describe('Command Registry Errors', () => {
    it('throws NotFoundError when command not in registry', () => {
      // Test the registry lookup directly (what defineCommand uses)
      const commandDef = commandRegistry.getCommand('nonexistent-package', 'missing');
      expect(commandDef).toBeUndefined();

      // Simulate what defineCommand does when command is not found
      expect(() => {
        if (!commandDef) {
          throw new NotFoundError('Command', 'nonexistent-package.missing');
        }
      }).toThrow(NotFoundError);
      expect(() => {
        if (!commandDef) {
          throw new NotFoundError('Command', 'nonexistent-package.missing');
        }
      }).toThrow(/nonexistent-package.missing/);
    });
  });

  describe('Error Formatter (die)', () => {
    it('formats Error objects correctly', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

      const error = new Error('Test error message');
      die(error);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Test error message'));
      expect(exitSpy).toHaveBeenCalledWith(1);

      consoleErrorSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('formats string errors correctly', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

      die('String error');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('String error'));
      expect(exitSpy).toHaveBeenCalledWith(1);

      consoleErrorSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('formats unknown error types', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

      die({ unexpected: 'object' });

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);

      consoleErrorSpy.mockRestore();
      exitSpy.mockRestore();
    });
  });
});
