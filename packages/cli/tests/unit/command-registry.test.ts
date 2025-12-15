/**
 * Unit tests for Command Registry
 *
 * Extended tests for command validation and edge cases
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CommandRegistry } from '../../src/core/command-registry';
import type { PackageCommandModule } from '../../src/types';
import { z } from 'zod';

describe('CommandRegistry', () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
  });

  describe('Package Registration', () => {
    it('should register a package', () => {
      const module: PackageCommandModule = {
        packageName: 'test',
        description: 'Test package',
        commands: [
          {
            name: 'test',
            description: 'Test command',
            schema: z.object({}),
            handler: async () => ({ success: true }),
          },
        ],
      };

      registry.registerPackage(module);
      expect(registry.getPackages()).toHaveLength(1);
    });

    it('should throw error on duplicate package registration', () => {
      const module: PackageCommandModule = {
        packageName: 'test',
        description: 'Test package',
        commands: [],
      };

      registry.registerPackage(module);
      expect(() => registry.registerPackage(module)).toThrow('Package test is already registered');
    });

    it('should throw error on duplicate command registration', () => {
      const module: PackageCommandModule = {
        packageName: 'test',
        description: 'Test package',
        commands: [
          {
            name: 'test',
            description: 'Test command',
            schema: z.object({}),
            handler: async () => ({}),
          },
        ],
      };

      registry.registerPackage(module);

      const duplicateModule: PackageCommandModule = {
        packageName: 'test2',
        description: 'Test package 2',
        commands: [
          {
            name: 'test',
            description: 'Test command',
            schema: z.object({}),
            handler: async () => ({}),
          },
        ],
      };

      // This should work - different package
      registry.registerPackage(duplicateModule);
      expect(registry.getPackages()).toHaveLength(2);
    });
  });

  describe('Command Retrieval', () => {
    it('should get command by full name', () => {
      const module: PackageCommandModule = {
        packageName: 'test',
        description: 'Test package',
        commands: [
          {
            name: 'test',
            description: 'Test command',
            schema: z.object({}),
            handler: async () => ({ success: true }),
          },
        ],
      };

      registry.registerPackage(module);
      const command = registry.getCommand('test', 'test');
      expect(command).toBeDefined();
      expect(command?.name).toBe('test');
    });

    it('should return undefined for non-existent command', () => {
      const command = registry.getCommand('nonexistent', 'command');
      expect(command).toBeUndefined();
    });

    it('should get all commands for a package', () => {
      const module: PackageCommandModule = {
        packageName: 'test',
        description: 'Test package',
        commands: [
          {
            name: 'cmd1',
            description: 'Command 1',
            schema: z.object({}),
            handler: async () => ({}),
          },
          {
            name: 'cmd2',
            description: 'Command 2',
            schema: z.object({}),
            handler: async () => ({}),
          },
        ],
      };

      registry.registerPackage(module);
      const commands = registry.getPackageCommands('test');
      expect(commands).toHaveLength(2);
      expect(commands[0]?.name).toBe('cmd1');
      expect(commands[1]?.name).toBe('cmd2');
    });

    it('should return empty array for non-existent package', () => {
      const commands = registry.getPackageCommands('nonexistent');
      expect(commands).toEqual([]);
    });

    it('should get all registered commands', () => {
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

      const allCommands = registry.getAllCommands();
      expect(allCommands).toHaveLength(2);
    });
  });

  describe('Help Generation', () => {
    it('should generate help text for a package', () => {
      const module: PackageCommandModule = {
        packageName: 'test',
        description: 'Test package',
        commands: [
          {
            name: 'test',
            description: 'Test command',
            schema: z.object({}),
            handler: async () => ({ success: true }),
          },
        ],
      };

      registry.registerPackage(module);
      const help = registry.generatePackageHelp('test');
      expect(help).toContain('Test package');
      expect(help).toContain('test');
      expect(help).toContain('Test command');
    });

    it('should include examples in help text', () => {
      const module: PackageCommandModule = {
        packageName: 'test',
        description: 'Test package',
        commands: [
          {
            name: 'test',
            description: 'Test command',
            schema: z.object({}),
            handler: async () => ({}),
            examples: ['test example 1', 'test example 2'],
          },
        ],
      };

      registry.registerPackage(module);
      const help = registry.generatePackageHelp('test');
      expect(help).toContain('test example 1');
      expect(help).toContain('test example 2');
    });

    it('should return error message for non-existent package', () => {
      const help = registry.generatePackageHelp('nonexistent');
      expect(help).toBe('Package nonexistent not found');
    });

    it('should generate help text for all packages', () => {
      const module1: PackageCommandModule = {
        packageName: 'package1',
        description: 'Package 1 description',
        commands: [],
      };

      const module2: PackageCommandModule = {
        packageName: 'package2',
        description: 'Package 2 description',
        commands: [],
      };

      registry.registerPackage(module1);
      registry.registerPackage(module2);

      const help = registry.generateHelp();
      expect(help).toContain('Available packages');
      expect(help).toContain('package1');
      expect(help).toContain('package2');
      expect(help).toContain('Package 1 description');
      expect(help).toContain('Package 2 description');
    });
  });

  describe('Command Validation', () => {
    it('should validate command structure', () => {
      const invalidCommands = [
        {
          name: '',
          description: 'Test',
          schema: z.object({}),
          handler: async () => ({}),
        },
        {
          name: 'test',
          description: '',
          schema: z.object({}),
          handler: async () => ({}),
        },
        {
          name: 'test',
          description: 'Test',
          schema: null as unknown as z.ZodSchema,
          handler: async () => ({}),
        },
        {
          name: 'test',
          description: 'Test',
          schema: z.object({}),
          handler: null as unknown as () => Promise<unknown>,
        },
      ];

      for (const invalidCommand of invalidCommands) {
        expect(() => {
          registry.validateCommand(invalidCommand);
        }).toThrow();
      }
    });

    it('should accept valid commands', () => {
      const validCommand = {
        name: 'test',
        description: 'Test command',
        schema: z.object({}),
        handler: async () => ({}),
      };

      expect(() => {
        registry.validateCommand(validCommand);
      }).not.toThrow();
    });
  });
});
