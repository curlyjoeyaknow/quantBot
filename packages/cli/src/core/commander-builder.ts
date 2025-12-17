/**
 * Commander Builder - Build Commander commands from command registry
 *
 * Dynamically creates Commander.js commands from registered command definitions.
 */

import type { Command } from 'commander';
import { commandRegistry } from './command-registry.js';
import { execute } from './execute.js';
import type { z } from 'zod';
import { NotFoundError } from '@quantbot/utils';

// Note: Commander options are currently added manually in registerXCommands functions.
// Future enhancement: parse Zod schemas to auto-generate Commander options.

/**
 * Build Commander command from command definition
 */
function buildCommanderCommand(
  parent: Command,
  packageName: string,
  commandDef: { name: string; description: string; schema: z.ZodSchema; examples?: string[] }
): Command {
  const cmd = parent.command(commandDef.name).description(commandDef.description);

  // Add examples to help text if available
  if (commandDef.examples && commandDef.examples.length > 0) {
    cmd.addHelpText('after', `\nExamples:\n  ${commandDef.examples.join('\n  ')}`);
  }

  // Wire up the action to use execute()
  cmd.action(async (options) => {
    const fullCommandDef = commandRegistry.getCommand(packageName, commandDef.name);
    if (!fullCommandDef) {
      throw new NotFoundError('Command', `${packageName}.${commandDef.name}`);
    }
    await execute(fullCommandDef, options);
  });

  return cmd;
}

/**
 * Build all Commander commands from registry
 */
export function buildCommandsFromRegistry(program: Command): void {
  const packages = commandRegistry.getPackages();

  for (const pkg of packages) {
    // Create package command group
    const pkgCmd = program.command(pkg.packageName).description(pkg.description);

    // Add all commands from this package
    for (const command of pkg.commands) {
      buildCommanderCommand(pkgCmd, pkg.packageName, command);
    }
  }
}
