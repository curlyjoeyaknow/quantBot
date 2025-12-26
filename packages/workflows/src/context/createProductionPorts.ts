import type { ClockPort } from '@quantbot/core';
import type { ProductionPorts } from './ports.js';
import { createTelemetryConsoleAdapter } from '../adapters/telemetryConsoleAdapter.js';
import { createMarketDataBirdeyeAdapter } from '../adapters/marketDataBirdeyeAdapter.js';
import { createStateDuckdbAdapter } from '../adapters/stateDuckdbAdapter.js';
import { createQueryClickhouseAdapter } from '../adapters/queryClickhouseAdapter.js';
import { createExecutionStubAdapter } from '../adapters/executionStubAdapter.js';
import { getBirdeyeClient } from '@quantbot/api-clients';

// Execution Port Migration:
// - Current: ExecutionStubAdapter (safety-first, dry-run by default)
// - Future: Real execution adapter when live trading is needed
// - Migration guide: docs/architecture/execution-port-migration.md
// - All safety features (dry-run, circuit breaker, idempotency) must be preserved

function createSystemClock(): ClockPort {
  return { nowMs: () => Date.now() };
}

/**
 * Create production ports with real adapters where available, stubs otherwise
 */
export async function createProductionPorts(duckdbPath?: string): Promise<ProductionPorts> {
  // Wire real Birdeye client
  const birdeye = getBirdeyeClient();
  const marketData = createMarketDataBirdeyeAdapter(birdeye);

  // Wire StatePort adapter (DuckDB-backed for persistence)
  // Default to environment variable or fallback path
  const stateDbPath = duckdbPath || process.env.DUCKDB_PATH || 'data/tele.duckdb';
  const state = createStateDuckdbAdapter(stateDbPath);

  // Wire QueryPort adapter (ClickHouse-backed for analytical queries)
  const query = createQueryClickhouseAdapter();

  // Create clock first (needed by execution adapter)
  const clock = createSystemClock();

  // Wire ExecutionPort adapter (stub with safety-first features)
  // Default to dry-run mode (safety-first)
  // When real execution client (Jito, RPC) is available, replace with concrete adapter
  const execution = createExecutionStubAdapter({
    clock,
    dryRun: process.env.EXECUTION_DRY_RUN !== 'false', // Default to dry-run (safety-first)
    enableIdempotency: true,
    maxConsecutiveFailures: 5,
  });

  const ports: ProductionPorts = {
    telemetry: createTelemetryConsoleAdapter({ prefix: 'quantbot', clock }),
    clock,

    marketData,
    state,
    query,
    execution,
  };

  return ports;
}
