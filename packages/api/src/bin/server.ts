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

  await server.start();
}

main().catch((error) => {
  console.error('Failed to start API server:', error);
  process.exit(1);
});
