/**
 * Server Commands
 * ===============
 * Commands for starting the API server
 */

import type { Command } from 'commander';
import { z } from 'zod';
import { defineCommand } from '../core/defineCommand.js';
import { coerceNumber, coerceBoolean } from '../core/coerce.js';
import { commandRegistry } from '../core/command-registry.js';
import type { PackageCommandModule } from '../types/index.js';
import { serveSchema, serveHandler, type ServeArgs } from '../handlers/server/serve.js';

/**
 * Register server commands
 */
export function registerServerCommands(program: Command): void {
  const serveCmd = program
    .command('serve')
    .description('Start the QuantBot API server')
    .option('--port <number>', 'Server port', '3000')
    .option('--host <host>', 'Server host', '0.0.0.0')
    .option('--swagger', 'Enable Swagger documentation', false)
    .option('--no-swagger', 'Disable Swagger documentation');

  defineCommand(serveCmd, {
    name: 'serve',
    packageName: 'server',
    coerce: (raw) => ({
      ...raw,
      port: coerceNumber(raw.port),
      enableSwagger: coerceBoolean(raw.swagger),
    }),
    schema: serveSchema,
    handler: async (args: unknown, ctx) => {
      const typedArgs = args as ServeArgs;
      return await serveHandler(typedArgs, ctx);
    },
    examples: [
      'quantbot serve',
      'quantbot serve --port 8080',
      'quantbot serve --port 8080 --host localhost --swagger',
    ],
  });
}

// Register in command registry
const serverModule: PackageCommandModule = {
  packageName: 'server',
  description: 'API server commands',
  commands: [
    {
      name: 'serve',
      description: 'Start the QuantBot API server',
      schema: serveSchema,
      handler: async (args: unknown, ctx) => {
        const typedArgs = args as ServeArgs;
        return await serveHandler(typedArgs, ctx);
      },
      examples: ['quantbot serve', 'quantbot serve --port 8080'],
    },
  ],
};

commandRegistry.registerPackage(serverModule);

