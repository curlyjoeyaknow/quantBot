/**
 * Command Registry - Dynamic command loading and management
 */

import type { Command } from 'commander';
import type { CommandDefinition, PackageCommandModule } from '../types';

/**
 * Command registry for managing CLI commands
 */
export class CommandRegistry {
  private packages: Map<string, PackageCommandModule> = new Map();
  private commands: Map<string, CommandDefinition> = new Map();

  /**
   * Register a package command module
   */
  registerPackage(module: PackageCommandModule): void {
    if (this.packages.has(module.packageName)) {
      throw new Error(`Package ${module.packageName} is already registered`);
    }

    this.packages.set(module.packageName, module);

    // Register all commands from this package
    for (const command of module.commands) {
      const fullName = `${module.packageName}.${command.name}`;
      if (this.commands.has(fullName)) {
        throw new Error(`Command ${fullName} is already registered`);
      }
      this.commands.set(fullName, command);
    }
  }

  /**
   * Get a command by full name (package.command)
   */
  getCommand(packageName: string, commandName: string): CommandDefinition | undefined {
    const fullName = `${packageName}.${commandName}`;
    return this.commands.get(fullName);
  }

  /**
   * Get all commands for a package
   */
  getPackageCommands(packageName: string): CommandDefinition[] {
    const module = this.packages.get(packageName);
    return module?.commands ?? [];
  }

  /**
   * Get all registered packages
   */
  getPackages(): PackageCommandModule[] {
    return Array.from(this.packages.values());
  }

  /**
   * Get all registered commands
   */
  getAllCommands(): CommandDefinition[] {
    return Array.from(this.commands.values());
  }

  /**
   * Generate help text for a package
   */
  generatePackageHelp(packageName: string): string {
    const module = this.packages.get(packageName);
    if (!module) {
      return `Package ${packageName} not found`;
    }

    const lines: string[] = [];
    lines.push(`${module.description}`);
    lines.push('');
    lines.push('Commands:');
    for (const command of module.commands) {
      lines.push(`  ${command.name.padEnd(20)} ${command.description}`);
      if (command.examples && command.examples.length > 0) {
        for (const example of command.examples) {
          lines.push(`    Example: ${example}`);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate help text for all packages
   */
  generateHelp(): string {
    const lines: string[] = [];
    lines.push('Available packages:');
    lines.push('');

    for (const module of this.packages.values()) {
      lines.push(`  ${module.packageName.padEnd(20)} ${module.description}`);
    }

    return lines.join('\n');
  }

  /**
   * Validate command structure
   */
  validateCommand(command: CommandDefinition): void {
    if (!command.name || typeof command.name !== 'string') {
      throw new Error('Command name must be a non-empty string');
    }

    if (!command.description || typeof command.description !== 'string') {
      throw new Error('Command description must be a non-empty string');
    }

    if (!command.schema) {
      throw new Error('Command must have a Zod schema');
    }

    if (typeof command.handler !== 'function') {
      throw new Error('Command must have a handler function');
    }
  }
}

/**
 * Global command registry instance
 */
export const commandRegistry = new CommandRegistry();
