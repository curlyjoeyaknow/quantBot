/**
 * Handler for running DuckDB-based simulations.
 * Uses SimulationService to run simulations.
 *
 * Handler Flow (Canonical Pipeline):
 * 1. Command layer: Defines options, calls execute()
 * 2. execute(): Validates input, creates context, calls handler
 * 3. Handler (this file): Normalizes types, calls services, returns data
 * 4. Services: IO boundary (DuckDB, Python tools)
 * 5. Format/Render: execute() handles output formatting
 *
 * OHLCV Data Flow:
 * - Python simulator reads OHLCV from DuckDB `ohlcv_candles_d` table
 * - Falls back to `user_calls_d` for price data if candles not found
 * - Does NOT fetch from Birdeye API (that's the OHLCV ingestion job's responsibility)
 * - OHLCV ingestion should be run before simulation to ensure data availability
 */

import type { CommandContext } from '../../core/command-context.js';
import { ValidationError } from '@quantbot/utils';
import {
  runSimulationDuckdbSchema,
  type RunSimulationDuckdbArgs,
} from '../../command-defs/simulation.js';
import type { SimulationConfig } from '@quantbot/simulation';
import { addToQueue } from '../../core/ohlcv-queue.js';

// Re-export schema for convenience
export { runSimulationDuckdbSchema };
export type { RunSimulationDuckdbArgs };

/**
 * Handler function: pure use-case orchestration
 * - Normalizes types (ISO strings → Date)
 * - Chooses defaults
 * - Calls domain services (ctx.services.*)
 * - Returns plain data result (no printing)
 *
 * Handler must NOT:
 * - Parse argv (that's the command)
 * - Read env directly (use ctx/config)
 * - Access DB clients directly (use services)
 * - Spawn subprocesses directly (use PythonEngine service)
 */
export async function runSimulationDuckdbHandler(
  args: RunSimulationDuckdbArgs,
  ctx: CommandContext
) {
  const service = ctx.services.simulation();

  // Build config
  const config: SimulationConfig = {
    duckdb_path: args.duckdb,
    strategy: args.strategy,
    initial_capital: args.initial_capital,
    lookback_minutes: args.lookback_minutes,
    lookforward_minutes: args.lookforward_minutes,
  };

  if (args.batch) {
    config.batch = true;

    // Query DuckDB for calls to simulate
    const duckdbService = ctx.services.duckdbStorage();
    const callsResult = await duckdbService.queryCalls(args.duckdb, 1000); // Default limit: 1000 calls

    if (!callsResult.success || !callsResult.calls || callsResult.calls.length === 0) {
      throw new ValidationError(
        callsResult.error || 'No calls found in DuckDB for batch simulation',
        {
          operation: 'run_simulation_duckdb',
          mode: 'batch',
          duckdbPath: args.duckdb,
        }
      );
    }

    // Extract mints and alert timestamps
    config.mints = callsResult.calls.map(
      (call: { mint: string; alert_timestamp: string }) => call.mint
    );
    config.alert_timestamps = callsResult.calls.map(
      (call: { mint: string; alert_timestamp: string }) => call.alert_timestamp
    );
  } else {
    if (!args.mint) {
      throw new ValidationError('mint is required for single simulation', {
        operation: 'run_simulation_duckdb',
        mode: 'single',
      });
    }
    config.mint = args.mint;
    config.alert_timestamp = args.alert_timestamp || new Date().toISOString();
  }

  const result = await service.runSimulation(config);

  // Check for missing candles and add to queue
  // This allows OHLCV ingestion to prioritize these tokens on the next run
  if (result.results) {
    for (const simResult of result.results) {
      // Check if simulation failed due to missing candles
      if (simResult.error && simResult.error.includes('No candles')) {
        // Extract mint and alert_timestamp from result
        const mint = (simResult as { mint?: string }).mint;
        const alertTimestamp = (simResult as { alert_timestamp?: string }).alert_timestamp;

        if (mint && alertTimestamp) {
          // Add to OHLCV queue for prioritization
          await addToQueue(mint, alertTimestamp);
        }
      }
    }
  }

  return result;
}
