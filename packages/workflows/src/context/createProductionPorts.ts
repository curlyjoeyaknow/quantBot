import type { ClockPort } from '@quantbot/core';
import type { ProductionPorts } from './ports.js';
import { createTelemetryConsoleAdapter } from '../adapters/telemetryConsoleAdapter.js';
import { createMarketDataBirdeyeAdapter } from '../adapters/marketDataBirdeyeAdapter.js';
import { createStateDuckdbAdapter } from '../adapters/stateDuckdbAdapter.js';
import { getBirdeyeClient } from '@quantbot/api-clients';

// TODO: Replace these stub ports with real adapters incrementally.
// Keeping stubs here lets you migrate one workflow at a time without a repo-wide rewrite.

function createSystemClock(): ClockPort {
  return { nowMs: () => Date.now() };
}

/**
 * Create production ports with real adapters where available, stubs otherwise
 */
export async function createProductionPorts(
  duckdbPath?: string
): Promise<ProductionPorts> {
  // Wire real Birdeye client
  const birdeye = getBirdeyeClient();
  const marketData = createMarketDataBirdeyeAdapter(birdeye);

  // Wire StatePort adapter (DuckDB-backed for persistence)
  // Default to environment variable or fallback path
  const stateDbPath = duckdbPath || process.env.DUCKDB_PATH || 'data/tele.duckdb';
  const state = createStateDuckdbAdapter(stateDbPath);

  const ports: ProductionPorts = {
    telemetry: createTelemetryConsoleAdapter({ prefix: 'quantbot' }),
    clock: createSystemClock(),

    marketData,
    state,

    execution: {
      async execute(_request: import('@quantbot/core').ExecutionRequest): Promise<import('@quantbot/core').ExecutionResult> {
        throw new Error('ExecutionPort adapter not wired yet');
      },
      async isAvailable(): Promise<boolean> {
        throw new Error('ExecutionPort adapter not wired yet');
      },
    },
  };

  return ports;
}

