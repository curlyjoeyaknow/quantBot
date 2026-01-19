/**
 * Lab UI Commands
 * ===============
 * Commands for starting the lab UI server
 */

import type { Command } from 'commander';
import { z } from 'zod';
import { defineCommand } from '../core/defineCommand.js';
import { coerceNumber } from '../core/coerce.js';
import { commandRegistry } from '../core/command-registry.js';
import type { PackageCommandModule } from '../types/index.js';
import { labUiSchema, labUiHandler, type LabUiArgs } from '../handlers/lab-ui/lab-ui.js';

/**
 * Register lab-ui commands
 */
export function registerLabUiCommands(program: Command): void {
  const labUiCmd = program
    .command('lab-ui')
    .description('Start the QuantBot Lab UI server')
    .option('--port <number>', 'Server port', '3111');

  // Old defineCommand registration - replaced by registry system below
  // defineCommand(labUiCmd, {
  //   name: 'lab-ui',
  //   packageName: 'lab-ui',
  //   coerce: (raw) => ({
  //     ...raw,
  //     port: coerceNumber(raw.port),
  //   }),
  //   schema: labUiSchema,
  //   handler: async (args: unknown, ctx) => {
  //     const typedArgs = args as LabUiArgs;
  //     return await labUiHandler(typedArgs, ctx);
  //   },
  //   examples: ['quantbot lab-ui', 'quantbot lab-ui --port 4000'],
  // });
}

// Register in command registry
const labUiModule: PackageCommandModule = {
  packageName: 'lab-ui',
  description: 'Lab UI server commands',
  commands: [
    {
      name: 'lab-ui',
      description: 'Start the QuantBot Lab UI server',
      schema: labUiSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedArgs = args as LabUiArgs;
        return await labUiHandler(typedArgs, ctx as any);
      },
      examples: ['quantbot lab-ui', 'quantbot lab-ui --port 4000'],
    },
  ],
};

commandRegistry.registerPackage(labUiModule);
