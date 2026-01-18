/**
 * Handler for `quantbot serve` command
 * Starts the Fastify API server
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { createApiServer } from '../../server/server.js';

export const serveSchema = z.object({
  port: z.number().int().positive().optional(),
  host: z.string().optional(),
  enableSwagger: z.boolean().optional(),
});

export type ServeArgs = z.infer<typeof serveSchema>;

export async function serveHandler(args: ServeArgs, _ctx: CommandContext) {
  const server = await createApiServer({
    port: args.port,
    host: args.host,
    enableSwagger: args.enableSwagger,
  });

  // Type assertion: server has start method added in createApiServer
  type ServerWithStart = typeof server & { start: () => Promise<void> };
  await (server as ServerWithStart).start();

  return {
    success: true,
    message: `API server started on ${args.host || '0.0.0.0'}:${args.port || 3000}`,
  };
}
