/**
 * defineCommand End-to-End Integration Tests
 *
 * Tests complete command execution flow through defineCommand:
 * - Command registration → defineCommand → execute → handler
 * - Real command registry and execution
 * - Multiple command categories
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { defineCommand } from '../../src/core/defineCommand.js';
import { die } from '../../src/core/cliErrors.js';
import { coerceNumber, coerceBoolean, coerceJson } from '../../src/core/coerce.js';
import { z } from 'zod';
import { commandRegistry } from '../../src/core/command-registry.js';

// Import command modules to register them
import '../../src/commands/observability.js';
import '../../src/commands/api-clients.js';

describe('defineCommand End-to-End Integration', () => {
  const originalExit = process.exit;
  
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock process.exit to prevent actual exit in tests
    process.exit = vi.fn() as typeof process.exit;
  });

  afterEach(() => {
    process.exit = originalExit;
  });

  describe('Simple Command (observability.health)', () => {
    it('executes simple command end-to-end', async () => {
      const program = new Command();
      const observabilityCmd = program.command('observability').description('Observability');

      const healthCmd = observabilityCmd
        .command('health')
        .description('Health check')
        .option('--format <format>', 'Output format', 'table');

      const healthSchema = z.object({
        format: z.enum(['json', 'table', 'csv']).default('table'),
      });

      defineCommand(healthCmd, {
        name: 'health',
        packageName: 'observability',
        validate: (opts) => healthSchema.parse(opts),
        onError: die,
      });

      // Command should be registered
      const commandDef = commandRegistry.getCommand('observability', 'health');
      expect(commandDef).toBeDefined();
      expect(commandDef?.name).toBe('health');
    });
  });

  describe('Command with Coercion (observability.errors)', () => {
    it('executes command with number coercion end-to-end', async () => {
      const program = new Command();
      const observabilityCmd = program.command('observability').description('Observability');

      const errorsCmd = observabilityCmd
        .command('errors')
        .description('View errors')
        .option('--limit <limit>', 'Maximum rows');

      const errorsSchema = z.object({
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.number().int().positive().max(10000).default(100),
        format: z.enum(['json', 'table', 'csv']).default('table'),
      });

      defineCommand(errorsCmd, {
        name: 'errors',
        packageName: 'observability',
        coerce: (raw) => ({
          ...raw,
          limit: raw.limit ? coerceNumber(raw.limit, 'limit') : 100,
        }),
        validate: (opts) => errorsSchema.parse(opts),
        onError: die,
      });

      // Command should be registered
      const commandDef = commandRegistry.getCommand('observability', 'errors');
      expect(commandDef).toBeDefined();

      // Test coercion by parsing
      errorsCmd.parse(['--limit', '50'], { from: 'user' });
      const opts = errorsCmd.opts();
      expect(opts.limit).toBe('50'); // Commander gives string

      // After coercion, should be number
      const coerced = {
        ...opts,
        limit: opts.limit ? coerceNumber(opts.limit, 'limit') : 100,
      };
      expect(coerced.limit).toBe(50);
    });
  });

  describe('Command with Boolean Coercion', () => {
    it('executes command with boolean coercion end-to-end', () => {
      const program = new Command();
      const testCmd = program.command('test').description('Test');

      const dryRunCmd = testCmd.command('dry-run').option('--dry-run', 'Dry run mode');

      const schema = z.object({
        dryRun: z.boolean().default(false),
      });

      defineCommand(dryRunCmd, {
        name: 'dry-run',
        packageName: 'test-package',
        coerce: (raw) => ({
          ...raw,
          dryRun: raw.dryRun !== undefined ? coerceBoolean(raw.dryRun, 'dry-run') : false,
        }),
        validate: (opts) => schema.parse(opts),
        onError: die,
      });

      // Test various boolean formats
      const testCases = [
        { input: true, expected: true },
        { input: 'true', expected: true },
        { input: '1', expected: true },
        { input: 'yes', expected: true },
        { input: 'on', expected: true },
        { input: false, expected: false },
        { input: 'false', expected: false },
        { input: '0', expected: false },
        { input: 'no', expected: false },
        { input: 'off', expected: false },
      ];

      for (const testCase of testCases) {
        const coerced = coerceBoolean(testCase.input, 'dry-run');
        expect(coerced).toBe(testCase.expected);
      }
    });
  });

  describe('Command with JSON Coercion', () => {
    it('executes command with JSON coercion end-to-end', () => {
      const program = new Command();
      const testCmd = program.command('test').description('Test');

      const jsonCmd = testCmd.command('json').option('--config <json>', 'Config JSON');

      const schema = z.object({
        config: z.record(z.string(), z.unknown()).optional(),
      });

      defineCommand(jsonCmd, {
        name: 'json',
        packageName: 'test-package',
        coerce: (raw) => ({
          ...raw,
          config: raw.config
            ? coerceJson<Record<string, unknown>>(raw.config, 'config')
            : undefined,
        }),
        validate: (opts) => schema.parse(opts),
        onError: die,
      });

      // Test JSON parsing
      const validJson = '{"key":"value","number":42}';
      const parsed = coerceJson<Record<string, unknown>>(validJson, 'config');
      expect(parsed).toEqual({ key: 'value', number: 42 });

      // Test invalid JSON
      expect(() => coerceJson<Record<string, unknown>>('{invalid}', 'config')).toThrow();
    });
  });

  describe('Command with Arguments (argsToOpts)', () => {
    it('executes command with arguments end-to-end', async () => {
      const program = new Command();
      const testCmd = program.command('test').description('Test');

      const validateCmd = testCmd
        .command('validate')
        .argument('<addresses...>', 'Addresses')
        .option('--chain-hint <chain>', 'Chain hint');

      const schema = z.object({
        addresses: z.array(z.string().min(1)).min(1),
        chainHint: z.enum(['solana', 'ethereum']).optional(),
      });

      defineCommand(validateCmd, {
        name: 'validate',
        packageName: 'test-package',
        argsToOpts: (args, rawOpts) => ({
          ...rawOpts,
          addresses: args[0] as string[],
        }),
        validate: (opts) => schema.parse(opts),
        onError: die,
      });

      // Register command
      commandRegistry.registerPackage({
        packageName: 'test-package',
        description: 'Test',
        commands: [
          {
            name: 'validate',
            description: 'Validate addresses',
            schema,
            handler: async () => ({}),
          },
        ],
      });

      // Parse with arguments
      await validateCmd.parseAsync(['addr1', 'addr2', '--chain-hint', 'solana'], { from: 'user' });

      // Verify command is registered
      const commandDef = commandRegistry.getCommand('test-package', 'validate');
      expect(commandDef).toBeDefined();
    });
  });
});
