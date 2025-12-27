#!/usr/bin/env node
/**
 * Lab Server Entry Point
 * 
 * Starts the Fastify server for the lab UI.
 */

import('../dist/server.js').then((module) => {
  const port = parseInt(process.env.PORT || '3001', 10);
  module.startServer(port);
});

