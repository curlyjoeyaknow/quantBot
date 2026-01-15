/**
 * Architecture commands - boundary verification and testing
 */

import { Command } from 'commander';
import { defineCommand } from '../core/defineCommand.js';
import {
  architectureVerifyBoundariesSchema,
  architectureTestBoundariesSchema,
  type ArchitectureVerifyBoundariesArgs,
  type ArchitectureTestBoundariesArgs,
} from '../command-defs/architecture.js';
import { verifyBoundariesHandler } from '../handlers/architecture/verify-boundaries.js';
import { testBoundariesHandler } from '../handlers/architecture/test-boundaries.js';
import type { PackageCommandModule } from '../types/index.js';
import type { CommandContext } from '../core/command-context.js';

/**
 * Register architecture commands
 */
export function registerArchitectureCommands(program: Command): void {
  const archCmd = program
    .command('architecture')
    .description('Architecture boundary verification and testing');

  // Verify boundaries command
  const verifyCmd = archCmd
    .command('verify-boundaries')
    .description('Verify architecture boundaries using ESLint')
    .option('--format <format>', 'Output format (json|table)', 'table');

  defineCommand(verifyCmd, {
    name: 'verify-boundaries',
    packageName: 'architecture',
    coerce: (raw: Record<string, unknown>) => ({
      format: raw.format || 'table',
    }),
    validate: (opts: Record<string, unknown>) => architectureVerifyBoundariesSchema.parse(opts),
    onError: (error: unknown) => {
      console.error('Error verifying boundaries:', error);
      process.exit(1);
    },
  });

  // Test boundaries command
  const testCmd = archCmd
    .command('test-boundaries')
    .description('Test architecture boundaries using verification script')
    .option('--format <format>', 'Output format (json|table)', 'table');

  defineCommand(testCmd, {
    name: 'test-boundaries',
    packageName: 'architecture',
    coerce: (raw: Record<string, unknown>) => ({
      format: raw.format || 'table',
    }),
    validate: (opts: Record<string, unknown>) => architectureTestBoundariesSchema.parse(opts),
    onError: (error: unknown) => {
      console.error('Error testing boundaries:', error);
      process.exit(1);
    },
  });
}

/**
 * Register as package command module
 */
const architectureModule: PackageCommandModule = {
  packageName: 'architecture',
  description: 'Architecture boundary verification and testing',
  commands: [
    {
      name: 'verify-boundaries',
      description: 'Verify architecture boundaries using ESLint',
      schema: architectureVerifyBoundariesSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedArgs = args as ArchitectureVerifyBoundariesArgs;
        const typedCtx = ctx as CommandContext;
        return await verifyBoundariesHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot architecture verify-boundaries',
        'quantbot architecture verify-boundaries --format json',
      ],
    },
    {
      name: 'test-boundaries',
      description: 'Test architecture boundaries using verification script',
      schema: architectureTestBoundariesSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedArgs = args as ArchitectureTestBoundariesArgs;
        const typedCtx = ctx as CommandContext;
        return await testBoundariesHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot architecture test-boundaries',
        'quantbot architecture test-boundaries --format json',
      ],
    },
  ],
};

import { commandRegistry } from '../core/command-registry.js';

commandRegistry.registerPackage(architectureModule);

export default architectureModule;
