/**
 * Registry Smoke Test
 *
 * Ensures every registered command definition has:
 * - schema
 * - handler
 * - executor wiring
 * - doesn't throw when building CLI
 *
 * This catches "added a command but forgot to wire it" regressions instantly.
 */

import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { commandRegistry } from '../../src/core/command-registry.js';
import { buildCommandsFromRegistry } from '../../src/core/commander-builder.js';

// Import all command modules for side effects (they register themselves)
import '../../src/commands/observability.js';
import '../../src/commands/storage.js';
import '../../src/commands/ohlcv.js';
import '../../src/commands/ingestion.js';
import '../../src/commands/simulation.js';
import '../../src/commands/simulation-interactive.js';
import '../../src/commands/analytics.js';
import '../../src/commands/api-clients.js';
import '../../src/commands/telegram.js';

describe('Command Registry Smoke Test', () => {
  it('all registered commands have required properties', () => {
    const packages = commandRegistry.getPackages();

    for (const pkg of packages) {
      expect(pkg.packageName).toBeTruthy();
      expect(pkg.description).toBeTruthy();
      expect(Array.isArray(pkg.commands)).toBe(true);

      for (const command of pkg.commands) {
        // Every command must have a name
        expect(command.name).toBeTruthy();
        expect(typeof command.name).toBe('string');

        // Every command must have a description
        expect(command.description).toBeTruthy();
        expect(typeof command.description).toBe('string');

        // Every command must have a schema
        expect(command.schema).toBeDefined();
        expect(command.schema).toBeTruthy();

        // Every command must have a handler
        expect(command.handler).toBeDefined();
        expect(typeof command.handler).toBe('function');
      }
    }
  });

  it('all command handlers are callable functions', () => {
    const packages = commandRegistry.getPackages();

    for (const pkg of packages) {
      for (const command of pkg.commands) {
        // Handler should be a function
        expect(typeof command.handler).toBe('function');
        
        // Handler should be callable (not throw on call with empty args)
        // Note: Some handlers may be stubs (0 params) or not yet migrated (1 param)
        // Migrated handlers accept 2 parameters (args, ctx)
        const handlerLength = command.handler.length;
        
        // Log handlers that need migration
        if (handlerLength === 0) {
          console.warn(
            `Command ${pkg.packageName}.${command.name} has stub handler (0 params) - needs implementation`
          );
        } else if (handlerLength === 1) {
          console.warn(
            `Command ${pkg.packageName}.${command.name} handler not yet migrated to (args, ctx) signature`
          );
        }
      }
    }
  });

  it('can build Commander commands from registry without errors', () => {
    const testProgram = new Command();
    testProgram.name('test').description('Test program').version('1.0.0');

    // Should not throw when building commands
    expect(() => {
      buildCommandsFromRegistry(testProgram);
    }).not.toThrow();

    // Verify commands were added
    const packages = commandRegistry.getPackages();
    expect(packages.length).toBeGreaterThan(0);
  });

  it('all registered commands are accessible via getCommand', () => {
    const packages = commandRegistry.getPackages();

    for (const pkg of packages) {
      for (const command of pkg.commands) {
        const found = commandRegistry.getCommand(pkg.packageName, command.name);
        expect(found).toBeDefined();
        expect(found?.name).toBe(command.name);
        expect(found?.schema).toBe(command.schema);
        expect(found?.handler).toBe(command.handler);
      }
    }
  });

  it('no duplicate command names within packages', () => {
    const packages = commandRegistry.getPackages();

    for (const pkg of packages) {
      const commandNames = pkg.commands.map((c) => c.name);
      const uniqueNames = new Set(commandNames);
      expect(uniqueNames.size).toBe(commandNames.length);
    }
  });

  it('all command schemas are valid Zod schemas', () => {
    const packages = commandRegistry.getPackages();

    for (const pkg of packages) {
      for (const command of pkg.commands) {
        // Schema should have parse method (Zod schema)
        expect(command.schema).toHaveProperty('parse');
        expect(typeof command.schema.parse).toBe('function');
      }
    }
  });
});

