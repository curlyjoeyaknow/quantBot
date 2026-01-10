#!/usr/bin/env tsx
/**
 * API Server Entry Point
 */

import { createApiServer } from '../server.js';

async function main() {
  const server = await createApiServer({
    port: Number(process.env.PORT) || 3000,
    host: process.env.HOST || '0.0.0.0',
    enableSwagger: process.env.NODE_ENV !== 'production',
  });

  // Type assertion: server has start method added in createApiServer
  type ServerWithStart = typeof server & { start: () => Promise<void> };
  await (server as ServerWithStart).start();
}

main().catch((error) => {
  console.error('Failed to start API server:', error);
  process.exit(1);
});
