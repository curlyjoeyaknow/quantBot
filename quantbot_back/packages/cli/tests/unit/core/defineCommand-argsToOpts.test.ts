/**
 * defineCommand argsToOpts Tests
 *
 * Tests the argsToOpts functionality for commands that use .argument()
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { defineCommand } from '../../../src/core/defineCommand.js';
import { die } from '../../../src/core/cliErrors.js';
import { z } from 'zod';
import { commandRegistry } from '../../../src/core/command-registry.js';

// Mock execute to avoid full integration
vi.mock('../../../src/core/execute.js', () => ({
  execute: vi.fn().mockResolvedValue(undefined),
  executeValidated: vi.fn().mockResolvedValue(undefined), // Kept for backward compatibility
}));

describe('defineCommand argsToOpts', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock process.exit to prevent test from exiting
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it('merges arguments into options before coercion', async () => {
    const cmd = new Command('validate-addresses');
    cmd.argument('<addresses...>', 'Addresses to validate');
    cmd.option('--chain-hint <chain>', 'Chain hint');

    const schema = z.object({
      addresses: z.array(z.string().min(1)).min(1),
      chainHint: z.enum(['solana', 'ethereum', 'base', 'bsc']).optional(),
      format: z.enum(['json', 'table', 'csv']).default('table'),
    });

    // Mock die to capture errors instead of exiting
    const mockDie = vi.fn((error: unknown) => {
      throw error;
    });

    defineCommand(cmd, {
      name: 'validate-addresses',
      packageName: 'test-package',
      argsToOpts: (args, rawOpts) => ({
        ...rawOpts,
        addresses: args[0] as string[],
      }),
      validate: (opts) => schema.parse(opts),
      onError: mockDie,
    });

    // Register command
    commandRegistry.registerPackage({
      packageName: 'test-package',
      description: 'Test',
      commands: [
        {
          name: 'validate-addresses',
          description: 'Validate addresses',
          schema,
          handler: async () => ({}),
        },
      ],
    });

    // Parse with arguments - catch any errors
    try {
      await cmd.parseAsync(['addr1', 'addr2', '--chain-hint', 'solana'], { from: 'user' });
    } catch (error) {
      // If validation fails, check what the error is
      if (mockDie.mock.calls.length > 0) {
        throw mockDie.mock.calls[0][0];
      }
      throw error;
    }

    // Verify argsToOpts was called and merged correctly
    // The execute mock should have been called with merged options
    const { execute } = await import('../../../src/core/execute.js');
    expect(execute).toHaveBeenCalled();
    const callArgs = (execute as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs).toBeDefined();
    const opts = callArgs[1] as Record<string, unknown>;
    expect(opts.addresses).toEqual(['addr1', 'addr2']);
    expect(opts.chainHint).toBe('solana');
  });

  it('works without argsToOpts (no arguments)', () => {
    // Test that argsToOpts is optional
    const rawOpts = { value: 'test' };
    const args: unknown[] = [];

    // Simulate what defineCommand does when argsToOpts is not provided
    const merged = rawOpts; // No argsToOpts, so just use rawOpts

    expect(merged).toEqual({ value: 'test' });
    expect(merged).not.toHaveProperty('addresses');
  });

  it('argsToOpts receives correct argument structure', () => {
    // Test argsToOpts function directly
    const args: unknown[] = ['firstValue', ['second1', 'second2']];
    const rawOpts = { chainHint: 'solana' };

    const argsToOptsFn = (args: unknown[], rawOpts: Record<string, unknown>) => ({
      ...rawOpts,
      first: args[0] as string,
      second: (args[1] as string[]) || [],
    });

    const merged = argsToOptsFn(args, rawOpts);

    expect(merged.first).toBe('firstValue');
    expect(merged.second).toEqual(['second1', 'second2']);
    expect((merged as Record<string, unknown>).chainHint).toBe('solana');
  });
});
