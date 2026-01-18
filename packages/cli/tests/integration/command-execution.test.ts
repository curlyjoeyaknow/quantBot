/**
 * Integration tests for Command Execution
 *
 * Tests full command execution flows:
 * - Command registration and discovery
 * - Argument parsing and validation
 * - Error handling
 * - Output formatting
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandRegistry } from '../../src/core/command-registry';
import { parseArguments } from '../../src/core/argument-parser';
import { formatOutput } from '../../src/core/output-formatter';
import { handleError } from '../../src/core/error-handler';
import type { PackageCommandModule } from '../../src/types';
import { z } from 'zod';

// Mock storage dependencies
vi.mock('@quantbot/infra/storage', () => ({
  OhlcvRepository: vi.fn().mockImplementation(() => ({
    getCandles: vi.fn().mockResolvedValue([]),
  })),
  StrategiesRepository: vi.fn().mockImplementation(() => ({
    findByName: vi.fn().mockResolvedValue({ config: { profitTargets: [] } }),
  })),
  CallsRepository: vi.fn().mockImplementation(() => ({
    queryBySelection: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@quantbot/infra/utils', async () => {
  const actual =
    await vi.importActual<typeof import('@quantbot/infra/utils')>('@quantbot/infra/utils');
  return {
    ...actual,
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
    ValidationError: actual?.ValidationError || class ValidationError extends Error {},
  };
});

describe('Command Execution - Integration Tests', () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
    vi.clearAllMocks();
  });

  describe('Full Command Flow', () => {
    it('should execute a complete command flow', async () => {
      const testSchema = z.object({
        name: z.string(),
        count: z.number(),
      });

      const testModule: PackageCommandModule = {
        packageName: 'test',
        description: 'Test package',
        commands: [
          {
            name: 'test',
            description: 'Test command',
            schema: testSchema,
            handler: async (args) => {
              const parsed = parseArguments(testSchema, args);
              return {
                success: true,
                name: parsed.name,
                count: parsed.count,
              };
            },
          },
        ],
      };

      registry.registerPackage(testModule);
      const command = registry.getCommand('test', 'test');
      expect(command).toBeDefined();

      if (command) {
        const args = { name: 'test', count: 5 };
        const result = await command.handler(args);
        const output = formatOutput(result, 'json');

        expect(output).toContain('success');
        expect(output).toContain('test');
        expect(output).toContain('5');
      }
    });

    it('should handle validation errors in command flow', async () => {
      const testSchema = z.object({
        name: z.string(),
        count: z.number(),
      });

      const testModule: PackageCommandModule = {
        packageName: 'test',
        description: 'Test package',
        commands: [
          {
            name: 'test',
            description: 'Test command',
            schema: testSchema,
            handler: async (args) => {
              return parseArguments(testSchema, args);
            },
          },
        ],
      };

      registry.registerPackage(testModule);
      const command = registry.getCommand('test', 'test');
      expect(command).toBeDefined();

      if (command) {
        const invalidArgs = { name: 'test', count: 'invalid' };

        await expect(command.handler(invalidArgs)).rejects.toThrow();
      }
    });

    it('should format output in different formats', async () => {
      const testData = [
        { name: 'test1', value: 1 },
        { name: 'test2', value: 2 },
      ];

      const jsonOutput = formatOutput(testData, 'json');
      expect(jsonOutput).toContain('"name"');
      expect(jsonOutput).toContain('"test1"');

      const tableOutput = formatOutput(testData, 'table');
      expect(tableOutput).toContain('name');
      expect(tableOutput).toContain('value');
      expect(tableOutput).toContain('test1');

      const csvOutput = formatOutput(testData, 'csv');
      expect(csvOutput).toContain('name,value');
      expect(csvOutput).toContain('test1,1');
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle and format errors in command execution', () => {
      const error = new Error('Test error');
      const formatted = handleError(error, { context: 'test' });

      expect(formatted).toBe('Test error');
    });

    it('should sanitize sensitive information in errors', () => {
      const error = new Error('API key invalid: secret123');
      const formatted = handleError(error);

      expect(formatted).not.toContain('secret123');
      expect(formatted).toContain('error occurred');
    });

    it('should handle Solana-specific errors', () => {
      const error = new Error('Invalid mint address');
      const formatted = handleError(error);

      expect(formatted).toContain('Invalid mint address');
      expect(formatted).toContain('32-44 characters');
    });
  });

  describe('Command Registry Integration', () => {
    it('should register and retrieve multiple packages', () => {
      const module1: PackageCommandModule = {
        packageName: 'package1',
        description: 'Package 1',
        commands: [
          {
            name: 'cmd1',
            description: 'Command 1',
            schema: z.object({}),
            handler: async () => ({}),
          },
        ],
      };

      const module2: PackageCommandModule = {
        packageName: 'package2',
        description: 'Package 2',
        commands: [
          {
            name: 'cmd2',
            description: 'Command 2',
            schema: z.object({}),
            handler: async () => ({}),
          },
        ],
      };

      registry.registerPackage(module1);
      registry.registerPackage(module2);

      expect(registry.getPackages()).toHaveLength(2);
      expect(registry.getCommand('package1', 'cmd1')).toBeDefined();
      expect(registry.getCommand('package2', 'cmd2')).toBeDefined();
    });

    it('should generate help text for packages', () => {
      const module: PackageCommandModule = {
        packageName: 'test',
        description: 'Test package',
        commands: [
          {
            name: 'test',
            description: 'Test command',
            schema: z.object({}),
            handler: async () => ({}),
            examples: ['test example'],
          },
        ],
      };

      registry.registerPackage(module);
      const help = registry.generatePackageHelp('test');

      expect(help).toContain('Test package');
      expect(help).toContain('test');
      expect(help).toContain('Test command');
      expect(help).toContain('test example');
    });
  });

  describe('Argument Parsing Integration', () => {
    it('should parse and validate complex schemas', () => {
      const complexSchema = z.object({
        name: z.string(),
        count: z.number().int().positive(),
        optional: z.string().optional(),
        nested: z.object({
          value: z.string(),
        }),
      });

      const args = {
        name: 'test',
        count: 5,
        nested: { value: 'nested' },
      };

      const result = parseArguments(complexSchema, args);
      expect(result.name).toBe('test');
      expect(result.count).toBe(5);
      expect(result.nested.value).toBe('nested');
    });

    it('should provide helpful error messages for invalid arguments', () => {
      const schema = z.object({
        name: z.string(),
        count: z.number(),
      });

      const invalidArgs = { name: 'test', count: 'not-a-number' };

      expect(() => parseArguments(schema, invalidArgs)).toThrow();
      try {
        parseArguments(schema, invalidArgs);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const message = (error as Error).message;
        // Check that it's a formatted error message
        expect(typeof message).toBe('string');
        expect(message.length).toBeGreaterThan(0);
        // The error should mention count or invalid
        expect(message.toLowerCase()).toMatch(/count|invalid|argument|number/i);
      }
    });
  });
});
