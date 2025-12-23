/**
 * @quantbot/api
 *
 * REST API for QuantBot using Fastify
 *
 * Endpoints:
 * - GET /health - Health check
 * - GET /api/v1/ohlcv/stats - OHLCV statistics
 * - GET /api/v1/simulation/runs - List simulation runs
 * - POST /api/v1/simulation/runs - Create simulation run
 * - GET /api/v1/simulation/runs/:runId - Get simulation run details
 */

export { createApiServer } from './server.js';
export type { ApiServerConfig } from './server.js';
